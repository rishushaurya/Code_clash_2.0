"""Pratibimb edge worker: watches a CCTV stream, a USB camera or a video file on a campus machine
and sends the same CvReading the browser camera page sends. Video never leaves this machine.

    python edge.py --room LH-3 --camera 2 --source rtsp://user:pass@10.0.0.5:554/stream1 --zones zones-LH-3.json
    python edge.py --room LH-3 --source 0            # first USB camera, as camera LH-3/cam-1
    python edge.py --selftest                        # runs the checks below, no camera needed

Readings go to the workspace's live channel when SUPABASE_URL, SUPABASE_ANON_KEY and PRATIBIMB_CHANNEL
are set (Setup, Integrations, shows the channel); otherwise they are printed as JSON lines (dry run).
Zones come from the Cameras page's "Copy zones" button; use the same camera number as that camera.
"""

import argparse
import json
import os
import statistics
import time
import urllib.request
from collections import deque
from pathlib import Path

# The workspace's private channel, shown in Setup; its name carries a secret, so keep it out of logs.
CHANNEL = os.environ.get('PRATIBIMB_CHANNEL', '')
MODEL = Path(__file__).resolve().parent.parent / 'public' / 'models' / 'efficientdet_lite0.tflite'
PERSON_MIN_SCORE = 0.4
# Person candidates down to this score are kept to say how sure "nobody" is (src/cv/detector.ts)
NEAR_MISS_FLOOR = 0.15
SMOOTHING_WINDOW = 5
DETECT_EVERY_S = 0.5
READING_EVERY_S = 2.0
LIGHT_HYSTERESIS = 0.15
CALIBRATION_MIN_GAP = 8  # src/shared/config.ts
REF = 'REF'  # reference wall patch: brightness is read relative to it
MOTION_ON_THRESHOLD = 6
PROBE_WIDTH = 320  # same downscale as the browser, so brightness references match


def is_calibrated(z):
    return z.get('onRef') is not None and z.get('offRef') is not None and abs(z['onRef'] - z['offRef']) >= CALIBRATION_MIN_GAP


def classify(z, lum):
    """Same rule as src/cv/lightZones.ts: on above the midpoint plus a band, off below it, unchanged in between."""
    if not is_calibrated(z):
        return None
    mid = (z['onRef'] + z['offRef']) / 2
    band = abs(z['onRef'] - z['offRef']) * LIGHT_HYSTERESIS / 2
    brighter_when_on = z['onRef'] > z['offRef']
    if lum > mid + band:
        return brighter_when_on
    if lum < mid - band:
        return not brighter_when_on
    return z.get('on')


def in_region(box, region, w, h):
    """Same rule as the browser: a person counts when their feet are inside the room boundary."""
    if not region or not region.get('w'):
        return True
    fx = (box.origin_x + box.width / 2) / w
    fy = (box.origin_y + box.height) / h
    return region['x'] <= fx <= region['x'] + region['w'] and region['y'] <= fy <= region['y'] + region['h']


def mean_motion(prev, cur, z):
    """Mean change of the green channel inside a zone between two frames: turning fan blades move."""
    if prev is None or prev.shape != cur.shape:
        return 0.0
    h, w = cur.shape[:2]
    x0, y0 = int(z['x'] * w), int(z['y'] * h)
    x1, y1 = max(x0 + 1, int((z['x'] + z['w']) * w)), max(y0 + 1, int((z['y'] + z['h']) * h))
    a = prev[y0:y1, x0:x1, 1].astype('float32')
    b = cur[y0:y1, x0:x1, 1].astype('float32')
    return float(abs(b - a).mean())


def classify_zone(z, value):
    """Brightness zones need on/off references; fan (motion) zones also work uncalibrated."""
    if is_calibrated(z):
        return classify(z, value)
    return value > MOTION_ON_THRESHOLD if z.get('kind') == 'motion' else None


def mean_luminance(rgb, z):
    h, w = rgb.shape[:2]
    x0, y0 = int(z['x'] * w), int(z['y'] * h)
    x1, y1 = max(x0 + 1, int((z['x'] + z['w']) * w)), max(y0 + 1, int((z['y'] + z['h']) * h))
    patch = rgb[y0:y1, x0:x1].astype('float32')
    return float((0.2126 * patch[..., 0] + 0.7152 * patch[..., 1] + 0.0722 * patch[..., 2]).mean())


def relative_luminance(zone_lum, ref_lum):
    """Same as the browser: a zone as a share of the reference wall (64 = as bright as the wall), capped at 255."""
    return zone_lum if ref_lum is None else min(255.0, 64 * zone_lum / max(ref_lum, 1))


def confidence(scores, near_miss):
    """Mean score of the people counted; with nobody counted, one minus the best rejected candidate."""
    return round(sum(scores) / len(scores), 2) if scores else round(1 - near_miss, 2)


def make_reading(room, camera_id, counts, zones, scores, near_miss=NEAR_MISS_FLOOR):
    return {
        'roomId': room,
        'cameraId': camera_id,
        'sourceKind': 'python_edge',
        'ts': int(time.time() * 1000),
        'headcount': int(statistics.median_low(counts)) if counts else 0,
        'zones': {z['id']: z['on'] for z in zones if z.get('w') and z.get('kind') != 'region' and z['id'] != REF and z.get('on') is not None},
        'confidence': confidence(scores, near_miss),
    }


def send(reading):
    url, key = os.environ.get('SUPABASE_URL'), os.environ.get('SUPABASE_ANON_KEY')
    if not (url and key and CHANNEL):
        print(json.dumps(reading), flush=True)
        return
    body = json.dumps({'messages': [{'topic': CHANNEL, 'event': 'reading', 'payload': reading}]}).encode()
    req = urllib.request.Request(
        f'{url}/realtime/v1/api/broadcast',
        data=body,
        headers={'apikey': key, 'authorization': f'Bearer {key}', 'content-type': 'application/json'},
    )
    try:
        urllib.request.urlopen(req, timeout=5).close()
    except OSError as e:
        print(json.dumps({'level': 'warn', 'message': 'send failed', 'error': str(e)}), flush=True)


def make_detector():
    from mediapipe.tasks import python as mp_tasks
    from mediapipe.tasks.python import vision

    return vision.ObjectDetector.create_from_options(
        vision.ObjectDetectorOptions(
            base_options=mp_tasks.BaseOptions(model_asset_path=str(MODEL)),
            running_mode=vision.RunningMode.VIDEO,
            score_threshold=NEAR_MISS_FLOOR,
            category_allowlist=['person'],
            max_results=60,
        )
    )


def run(room, camera, source, zones, max_seconds=None):
    import cv2
    import mediapipe as mp

    cap = cv2.VideoCapture(int(source) if source.isdigit() else source)
    if not cap.isOpened():
        raise SystemExit(f'Cannot open source {source}')
    detector = make_detector()
    # A fixed id, so a restart continues the same camera instead of leaving a silent one behind.
    camera_id = f'{room}/cam-{camera}'
    counts, scores, prev_probe = deque(maxlen=SMOOTHING_WINDOW), [], None
    started = last_detect = last_send = time.monotonic()
    is_file = Path(source).is_file()
    frame_s = 1 / (cap.get(cv2.CAP_PROP_FPS) or 25)

    while max_seconds is None or time.monotonic() - started < max_seconds:
        ok, frame = cap.read()
        if is_file:
            time.sleep(frame_s)  # play files in real time, not as fast as the disk allows
        if not ok:
            if is_file:  # loop recorded video, like the browser does
                cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
                continue
            time.sleep(1)
            continue
        now = time.monotonic()
        if now - last_detect < DETECT_EVERY_S:
            continue
        last_detect = now
        rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        result = detector.detect_for_video(mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb), int((now - started) * 1000))
        region = next((z for z in zones if z.get('kind') == 'region'), None)
        found = [d for d in result.detections if in_region(d.bounding_box, region, rgb.shape[1], rgb.shape[0])]
        people = [d for d in found if d.categories[0].score >= PERSON_MIN_SCORE]
        near_miss = max([NEAR_MISS_FLOOR] + [d.categories[0].score for d in found if d.categories[0].score < PERSON_MIN_SCORE])
        counts.append(len(people))
        scores = [d.categories[0].score for d in people]
        probe = cv2.resize(rgb, (PROBE_WIDTH, max(1, round(PROBE_WIDTH * rgb.shape[0] / rgb.shape[1]))))
        ref = next((z for z in zones if z.get('id') == REF and z.get('w')), None)
        ref_lum = mean_luminance(probe, ref) if ref else None
        for z in zones:
            if z.get('w') and z.get('kind') != 'region' and z['id'] != REF:
                value = mean_motion(prev_probe, probe, z) if z.get('kind') == 'motion' else relative_luminance(mean_luminance(probe, z), ref_lum)
                z['on'] = classify_zone(z, value)
        prev_probe = probe
        if now - last_send >= READING_EVERY_S:
            last_send = now
            send(make_reading(room, camera_id, list(counts), zones, scores, near_miss))


def selftest():
    import numpy as np

    z = {'id': 'z1', 'x': 0.0, 'y': 0.0, 'w': 0.5, 'h': 0.5, 'onRef': 200.0, 'offRef': 40.0}
    assert classify(z, 210) is True and classify(z, 30) is False
    assert classify({**z, 'on': True}, 121) is True, 'inside the hysteresis band the state holds'
    assert classify({'id': 'z2', 'x': 0, 'y': 0, 'w': 1, 'h': 1}, 100) is None, 'uncalibrated zones report nothing'

    img = np.zeros((100, 100, 3), dtype='uint8')
    img[:50, :50] = 255
    assert abs(mean_luminance(img, z) - 255) < 0.01 and mean_luminance(img, {**z, 'x': 0.5}) < 0.01

    fan = {'id': 'F1', 'kind': 'motion', 'x': 0.0, 'y': 0.0, 'w': 1.0, 'h': 1.0}
    still, spin = np.zeros((10, 10, 3), dtype='uint8'), np.full((10, 10, 3), 40, dtype='uint8')
    assert classify_zone(fan, mean_motion(still, spin, fan)) is True and classify_zone(fan, mean_motion(still, still, fan)) is False

    class Box:
        origin_x, origin_y, width, height = 400, 200, 100, 300
    room = {'kind': 'region', 'x': 0.1, 'y': 0.3, 'w': 0.8, 'h': 0.7}
    assert in_region(Box, room, 1000, 600) and not in_region(Box, {**room, 'x': 0.6}, 1000, 600) and in_region(Box, None, 1000, 600)

    r = make_reading('LH-3', 'LH-3/edge-test', [0, 2, 2, 3, 2], [{**z, 'on': True}, {**room, 'id': 'ROOM', 'on': True}], [0.8, 0.6])
    assert r['headcount'] == 2 and r['zones'] == {'z1': True} and r['confidence'] == 0.7
    assert set(r) == {'roomId', 'cameraId', 'sourceKind', 'ts', 'headcount', 'zones', 'confidence'}
    assert make_reading('LH-3', 'LH-3/cam-1', [0], [], [], 0.35)['confidence'] == 0.65, 'nobody seen: the doubt, not 1'
    assert not is_calibrated({**z, 'onRef': 100, 'offRef': 100 + CALIBRATION_MIN_GAP - 1}), 'same gap as the browser'
    lamp = {**z, 'onRef': relative_luminance(200, 50), 'offRef': relative_luminance(60, 50)}
    assert classify(lamp, relative_luminance(96, 80)) is False, 'daylight scales wall and fixture alike'

    import mediapipe as mp

    detector = make_detector()
    blank = np.full((240, 320, 3), 128, dtype='uint8')
    assert len(detector.detect_for_video(mp.Image(image_format=mp.ImageFormat.SRGB, data=blank), 0).detections) == 0
    print('selftest passed')


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument('--room', help='room id, for example LH-3')
    p.add_argument('--camera', type=int, default=1, help='camera number in the room (default 1): LH-3/cam-1')
    p.add_argument('--source', help='RTSP URL, video file, or camera index')
    p.add_argument('--zones', help='JSON file from the camera page "Copy zones" button')
    p.add_argument('--seconds', type=float, help='stop after this many seconds')
    p.add_argument('--selftest', action='store_true')
    a = p.parse_args()
    if a.selftest:
        selftest()
    elif not (a.room and a.source):
        p.error('--room and --source are required')
    else:
        run(a.room, a.camera, a.source, json.loads(Path(a.zones).read_text()) if a.zones else [], a.seconds)
