// Pratibimb relay: the twin switches a 12 V lamp on the demo table.
// Protocol over USB serial at 9600 baud, one line per command:
//   "R1:0" switches the lamp off, "R1:1" switches it on. The board answers "OK R1:<state>".
// Low voltage only: the relay switches the 12 V lamp circuit, never 230 V mains.

const int RELAY_PIN = 7;
// Many cheap relay modules switch on when the input is LOW. Set to false if yours is active-high.
const bool ACTIVE_LOW = true;

void setLamp(bool on) {
  digitalWrite(RELAY_PIN, (on != ACTIVE_LOW) ? HIGH : LOW);
}

void setup() {
  pinMode(RELAY_PIN, OUTPUT);
  setLamp(true);  // the demo starts with the lamp on
  Serial.begin(9600);
}

void loop() {
  if (!Serial.available()) return;
  String line = Serial.readStringUntil('\n');
  line.trim();
  if (line == "R1:0" || line == "R1:1") {
    bool on = line.endsWith("1");
    setLamp(on);
    Serial.print("OK R1:");
    Serial.println(on ? 1 : 0);
  }
}
