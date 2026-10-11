// Shown on the twin while no room has a live input: the three ways to bring real data in.

import { Camera, Gauge, Hand } from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'
import { Link } from 'react-router'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { joinLink } from '@/shared/workspace'

export function ConnectInputs({ firstRoomId }: { firstRoomId: string }) {
  const cameraUrl = joinLink(`/camera/${firstRoomId}/new`)
  return (
    <Card className="border-highlight/40">
      <CardContent className="grid gap-5 md:grid-cols-[1fr_auto]">
        <div className="space-y-3">
          <div>
            <h2 className="font-heading text-xl font-semibold">Bring the building to life</h2>
            <p className="text-sm text-muted-foreground">Rooms stay grey until something real reports. Pick any of these; you can mix them room by room.</p>
          </div>
          <ol className="grid gap-3 text-sm sm:grid-cols-3">
            <li className="rounded-lg bg-muted p-3">
              <Camera className="mb-1 size-5 text-highlight" aria-hidden />
              <p className="font-medium">A camera</p>
              <p className="text-muted-foreground">Scan the code with a phone, or open the camera page on a spare laptop, and point it at the room.</p>
              <Button asChild size="sm" variant="link" className="h-auto p-0">
                <Link to={`/camera/${firstRoomId}/new`}>Add a camera on this device</Link>
              </Button>
            </li>
            <li className="rounded-lg bg-muted p-3">
              <Gauge className="mb-1 size-5 text-highlight" aria-hidden />
              <p className="font-medium">Sensors you already have</p>
              <p className="text-muted-foreground">Smart plugs, meters, motion sensors or your building system can post to the sensor API.</p>
              <Button asChild size="sm" variant="link" className="h-auto p-0">
                <Link to="/setup">See integrations</Link>
              </Button>
            </li>
            <li className="rounded-lg bg-muted p-3">
              <Hand className="mb-1 size-5 text-highlight" aria-hidden />
              <p className="font-medium">A person in the room</p>
              <p className="text-muted-foreground">Open any room and tap what you see: lights on, fans on, everything off.</p>
              <Button asChild size="sm" variant="link" className="h-auto p-0">
                <Link to={`/room/${firstRoomId}`}>Report for {firstRoomId}</Link>
              </Button>
            </li>
          </ol>
        </div>
        <div className="hidden flex-col items-center gap-1 md:flex">
          <div className="rounded-xl bg-white p-3">
            <QRCodeSVG value={cameraUrl} size={150} level="L" aria-label={`QR code that adds a phone camera to ${firstRoomId}`} />
          </div>
          <span className="text-xs text-muted-foreground">Phone camera for {firstRoomId}</span>
        </div>
      </CardContent>
    </Card>
  )
}
