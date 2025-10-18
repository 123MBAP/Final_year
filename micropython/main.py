# Ready-to-use MicroPython main.py for Pico W (refined with requested features)
# - Background WiFi reconnect while main loop continues
# - OLED shows WiFi state on top line: CONNECTED / CONNECTING / OFFLINE
# - Emergency clear requires pressing the EMERGENCY button again (not START)
# - Added MQTT topic for WiFi state (machine/wifi) with retained updates
# - Forward/reverse durations configurable via MQTT ("set_cycle" command)
# - Forward/reverse default durations: 7 seconds each (configurable)
# - Publishes cycle config to machine/cycle (retained) when changed
# Notes: keep hx711.py and ssd1306.py on the device if used.

import time
import network
import ujson
from machine import Pin, PWM, I2C
from umqtt.simple import MQTTClient

# Optional libs: copy hx711.py and ssd1306.py to the device if used
try:
    from hx711 import HX711
except Exception:
    HX711 = None
try:
    import ssd1306
except Exception:
    ssd1306 = None

# ---------- CONFIG ----------
WIFI_SSID = "Patrick@"
WIFI_PASS = "098765432"

# MQTT broker settings (plain TCP)
MQTT_BROKER = "test.mosquitto.org"
MQTT_PORT = 1883
MQTT_USER = None
MQTT_PASS = None

CLIENT_ID = b"pico_machine_" + bytes(str(time.ticks_ms()), "ascii")

TOPIC_WEIGHT = b"machine/weight"
TOPIC_DISTANCE = b"machine/distance"
TOPIC_STATUS = b"machine/status"
TOPIC_RPM = b"machine/rpm"
TOPIC_DIR = b"machine/dir"
TOPIC_COMMAND = b"machine/command"
TOPIC_WIFI = b"machine/wifi"
TOPIC_CYCLE = b"machine/cycle"

# ---------- HARDWARE PINS & SETTINGS ----------
DT_PINS = [2, 4, 5, 6]
SCK_PIN = 3
SCALES = [2000.0, 2000.0, 2000.0, 2000.0]
HX_MAX = 0x7FFFFF
HX_MIN = -0x800000

STEP_PIN = 10
DIR_PIN = 11
ENA_PIN = 12
STEP_ANGLE = 1.8
MICROSTEPS = 1
STEPS_PER_REV = int(360 / STEP_ANGLE * MICROSTEPS)
MIN_PULSE_US = 5

LED_GREEN_PIN = 14
LED_RED_PIN = 15
BUZZER_PIN = 16
BTN_EMERG_PIN = 18
BTN_START_PIN = 19

TRIG_PIN = 20
ECHO_PIN = 21

I2C_SDA = 0
I2C_SCL = 1

# Runtime/defaults
FORCE_RUN = True
THRESHOLD_KG = 2.0
DEFAULT_RPM = 300
MIN_RPM = 10
MAX_RPM = 700
PUBLISH_INTERVAL_MS = 1000
RAMP_TIME = 1.5  # seconds for ramping

# Forward/reverse cycle durations (seconds) - configurable via MQTT
FORWARD_DURATION_S = 7.0
REVERSE_DURATION_S = 7.0

# WiFi reconnect/backoff timings
WIFI_RETRY_INTERVAL_S = 5
MQTT_RETRY_INTERVAL_S = 5

# ---------- HARDWARE INIT ----------
led_green = Pin(LED_GREEN_PIN, Pin.OUT)
led_red = Pin(LED_RED_PIN, Pin.OUT)
buzzer = Pin(BUZZER_PIN, Pin.OUT)

btn_emerg = Pin(BTN_EMERG_PIN, Pin.IN, Pin.PULL_UP)
btn_start = Pin(BTN_START_PIN, Pin.IN, Pin.PULL_UP)

step_pin = Pin(STEP_PIN, Pin.OUT)
dir_pin = Pin(DIR_PIN, Pin.OUT)
ena_pin = Pin(ENA_PIN, Pin.OUT)
step_pin.value(0)
dir_pin.value(1)
ena_pin.value(1)

# i2c and oled
try:
    i2c = I2C(0, scl=Pin(I2C_SCL), sda=Pin(I2C_SDA))
    oled = ssd1306.SSD1306_I2C(128, 64, i2c) if ssd1306 else None
except Exception:
    oled = None

trig = Pin(TRIG_PIN, Pin.OUT)
echo = Pin(ECHO_PIN, Pin.IN)

# hx711 modules (optional)
sck_pin = Pin(SCK_PIN)
hx_modules = []
if HX711:
    for dt in DT_PINS:
        try:
            hx = HX711(d_out=Pin(dt), pd_sck=sck_pin)
        except TypeError:
            hx = HX711(Pin(dt), sck_pin)
        hx_modules.append(hx)

num_modules = len(hx_modules)
offsets = [0.0] * num_modules
valid = [True] * num_modules

# ---------- STATE ----------
wifi_ok = False
wifi_status = "offline"  # "connected", "connecting", "offline"
wlan = None
last_wifi_attempt = 0

mqtt_client = None
last_mqtt_attempt = 0

state = "idle"  # idle, run, done, emergency
_current_rpm = DEFAULT_RPM
_last_publish = time.ticks_ms()

# ---------- HELPERS ----------
def is_valid_raw(raw):
    try:
        if raw is None:
            return False
        r = int(raw)
    except Exception:
        return False
    if r <= -1 or r >= HX_MAX:
        return False
    return True


def stable_tare(hx, samples=20, delay_ms=10):
    s = []
    for _ in range(samples):
        try:
            r = hx.read()
        except Exception:
            r = None
        if is_valid_raw(r):
            s.append(int(r))
        time.sleep_ms(delay_ms)
    if not s:
        return None
    s.sort()
    quarter = max(1, len(s)//4)
    trimmed = s[quarter:-quarter] or s
    return sum(trimmed) / len(trimmed)


def tare_all():
    global offsets, valid
    offsets = [0.0] * num_modules
    valid = [True] * num_modules
    print("Taring modules...")
    for i, hx in enumerate(hx_modules):
        try:
            off = stable_tare(hx)
        except Exception as e:
            print("tare error for module", i, e)
            off = None
        if off is None:
            print("Module", i, "no valid tare")
            valid[i] = False
            offsets[i] = 0.0
        else:
            offsets[i] = off
            valid[i] = True
            print("Module", i, "offset", offsets[i])
    time.sleep_ms(200)
    print("Tare complete. valid:", valid)


def get_weight():
    total = 0.0
    used = 0
    raws = []
    scales = SCALES if len(SCALES) == num_modules else ([SCALES[0]] * num_modules)
    for i, hx in enumerate(hx_modules):
        try:
            raw = hx.read()
        except Exception:
            raw = None
        raws.append(raw)
        if not valid[i]:
            continue
        if not is_valid_raw(raw):
            valid[i] = False
            continue
        mass = (int(raw) - offsets[i]) / float(scales[i])
        total += mass
        used += 1
    if used == 0:
        return 0.0, raws, used
    return max(total, 0.0), raws, used


def measure_distance():
    trig.value(0)
    time.sleep_us(2)
    trig.value(1)
    time.sleep_us(10)
    trig.value(0)

    t0 = time.ticks_us()
    while echo.value() == 0:
        if time.ticks_diff(time.ticks_us(), t0) > 30000:
            return None
    start = time.ticks_us()

    t0 = time.ticks_us()
    while echo.value() == 1:
        if time.ticks_diff(time.ticks_us(), t0) > 30000:
            return None
    end = time.ticks_us()

    duration = time.ticks_diff(end, start)
    distance_cm = (duration / 2) / 29.1
    return distance_cm


def display_status(msg, weight, distance=None, progress=None):
    # Top line: WiFi status
    if not oled:
        return
    try:
        oled.fill(0)
        try:
            s = wifi_status.upper()
        except Exception:
            s = "UNKNOWN"
        oled.text('WIFI:' + s, 0, 0)
        oled.text('W:{:.2f}kg'.format(weight), 0, 12)
        oled.text('Status:', 64, 12)
        oled.text(str(msg), 64, 24)
        if distance is not None:
            oled.text('D:{:.1f}cm'.format(distance), 0, 24)
        if progress is not None:
            bar_w = int(progress * 128)
            for x in range(bar_w):
                for y in range(50, 60):
                    oled.pixel(x, y, 1)
            for x in range(128):
                oled.pixel(x, 50, 1)
                oled.pixel(x, 59, 1)
            for y in range(50, 60):
                oled.pixel(0, y, 1)
                oled.pixel(127, y, 1)
        oled.show()
    except Exception:
        pass


# Motor controls
_pwm = None
_current_freq = 0.0

def motor_enable():
    ena_pin.value(0)
    time.sleep_ms(3)

def motor_disable():
    ena_pin.value(1)
    time.sleep_ms(3)


def start_pwm(freq_hz, duty_percent=50):
    global _pwm, _current_freq
    try:
        stop_pwm()
    except Exception:
        pass
    try:
        pwm = PWM(step_pin)
    except Exception:
        pwm = PWM(step_pin)
    try:
        pwm.freq(int(max(1, freq_hz)))
    except Exception:
        pass
    try:
        pwm.duty_u16(int(65535 * duty_percent / 100))
    except Exception:
        try:
            pwm.duty(int(1023 * duty_percent / 100))
        except Exception:
            pass
    _pwm = pwm
    _current_freq = freq_hz
    motor_enable()
    return pwm


def stop_pwm():
    global _pwm, _current_freq
    if _pwm is not None:
        try:
            _pwm.deinit()
        except Exception:
            pass
        _pwm = None
    _current_freq = 0.0
    motor_disable()


def rpm_to_freq(rpm):
    return (STEPS_PER_REV * rpm) / 60.0


def compute_duty_for_freq(freq_hz):
    if not freq_hz or freq_hz <= 0:
        return 0
    period_us = 1_000_000.0 / float(freq_hz)
    duty_ratio = max(MIN_PULSE_US / period_us, 0.02)
    duty_percent = min(90, int(duty_ratio * 100))
    return duty_percent


def ramp_to_target(old_freq, new_freq, ramp_time_local=1.5, steps=20):
    if new_freq == old_freq:
        return True
    dt_ms = int(max(1, (ramp_time_local * 1000) / steps))
    for i in range(1, steps + 1):
        frac = i / float(steps)
        f = old_freq + (new_freq - old_freq) * frac
        duty = compute_duty_for_freq(f) if f > 0 else 0
        start_pwm(f, duty)
        time.sleep_ms(dt_ms)
    return True


def run_forward_reverse(forward_s=None, reverse_s=None):
    global _pwm
    if forward_s is None:
        forward_s = FORWARD_DURATION_S
    if reverse_s is None:
        reverse_s = REVERSE_DURATION_S

    target_freq = rpm_to_freq(_current_rpm)
    duty = compute_duty_for_freq(target_freq)

    # Forward
    dir_pin.value(1)
    mqtt_publish(TOPIC_DIR, "FWD", retain=True)
    ramp_to_target(_current_freq, target_freq, ramp_time_local=RAMP_TIME)
    pwm_local = start_pwm(target_freq, duty)
    t0 = time.ticks_ms()
    while time.ticks_diff(time.ticks_ms(), t0) < forward_s * 1000:
        if not btn_emerg.value():
            try:
                pwm_local.deinit()
            except Exception:
                pass
            motor_disable()
            return None
        try:
            w, _, _ = get_weight() if hx_modules else (0.0, [], 0)
        except Exception:
            w = 0.0
        d = measure_distance()
        elapsed = time.ticks_diff(time.ticks_ms(), t0) / 1000.0
        display_status("RUN FWD", w, d, progress=elapsed / float(max(1, forward_s)))
        time.sleep_ms(50)

    try:
        pwm_local.deinit()
    except Exception:
        pass

    # Reverse
    dir_pin.value(0)
    mqtt_publish(TOPIC_DIR, "REV", retain=True)
    ramp_to_target(0.0, target_freq, ramp_time_local=RAMP_TIME)
    pwm_local = start_pwm(target_freq, duty)
    t0 = time.ticks_ms()
    while time.ticks_diff(time.ticks_ms(), t0) < reverse_s * 1000:
        if not btn_emerg.value():
            try:
                pwm_local.deinit()
            except Exception:
                pass
            motor_disable()
            return None
        try:
            w, _, _ = get_weight() if hx_modules else (0.0, [], 0)
        except Exception:
            w = 0.0
        d = measure_distance()
        elapsed = time.ticks_diff(time.ticks_ms(), t0) / 1000.0
        display_status("RUN REV", w, d, progress=elapsed / float(max(1, reverse_s)))
        time.sleep_ms(50)

    try:
        pwm_local.deinit()
    except Exception:
        pass
    stop_pwm()
    return True


def run_speed_sequence():
    # Run forward/reverse cycle using configured durations
    return run_forward_reverse(FORWARD_DURATION_S, REVERSE_DURATION_S)


def emergency_stop():
    global _pwm, state
    print("EMERGENCY STOP")
    try:
        if _pwm:
            _pwm.deinit()
    except Exception:
        pass
    stop_pwm()
    led_green.value(0)
    led_red.value(1)
    buzzer.value(1)
    state = "emergency"
    try:
        mqtt_publish(TOPIC_STATUS, state, retain=True)
    except Exception:
        pass
    display_status("EMERGENCY - press EMERG", 0.0, None)

    # Wait for EMERGENCY button press to clear (btn_emerg is active-low)
    while True:
        # allow some background processing (MQTT check)
        try:
            if mqtt_client:
                mqtt_client.check_msg()
        except Exception:
            pass
        # Allow clearing emergency via MQTT: if another context changed state, exit
        if state != "emergency":
            # cleanup done by caller or mqtt handler — ensure indicators reset
            try:
                buzzer.value(0)
            except Exception:
                pass
            try:
                led_red.value(0)
            except Exception:
                pass
            try:
                led_green.value(1)
            except Exception:
                pass
            print("Emergency cleared via MQTT/state change")
            break
        # Clear only when emergency button pressed again (active low)
        if not btn_emerg.value():
            # Debounce
            time.sleep_ms(50)
            if not btn_emerg.value():
                buzzer.value(0)
                led_red.value(0)
                led_green.value(1)
                state = "idle"
                try:
                    mqtt_publish(TOPIC_STATUS, state, retain=True)
                except Exception:
                    pass
                display_status("RESET", 0.0, None)
                time.sleep_ms(200)
                break
        time.sleep_ms(100)


# ---------- WiFi & MQTT (background-friendly) ----------
def init_wlan():
    global wlan, wifi_ok, wifi_status
    try:
        wlan = network.WLAN(network.STA_IF)
        wlan.active(True)
    except Exception:
        wlan = None
        wifi_ok = False
        wifi_status = "offline"


def ensure_wifi():
    # Non-blocking/background attempts to connect. Throttled by WIFI_RETRY_INTERVAL_S.
    global wlan, wifi_ok, wifi_status, last_wifi_attempt
    old = wifi_status
    if wlan is None:
        init_wlan()
    if wlan is None:
        wifi_ok = False
        wifi_status = "offline"
        if wifi_status != old:
            print("WiFi status:", wifi_status)
        return False
    if wlan.isconnected():
        if not wifi_ok or wifi_status != "connected":
            wifi_ok = True
            wifi_status = "connected"
            print("WiFi connected:", wlan.ifconfig())
        if wifi_status != old:
            # publish wifi state if mqtt active
            try:
                mqtt_publish(TOPIC_WIFI, wifi_status, retain=True)
            except Exception:
                pass
        return True
    # Not connected
    now = time.time()
    if now - last_wifi_attempt < WIFI_RETRY_INTERVAL_S:
        wifi_ok = False
        wifi_status = "connecting"
        if wifi_status != old:
            try:
                mqtt_publish(TOPIC_WIFI, wifi_status, retain=True)
            except Exception:
                pass
        return False
    # attempt connect (non-blocking)
    try:
        wifi_status = "connecting"
        print("Attempting WiFi connect...")
        wlan.connect(WIFI_SSID, WIFI_PASS)
        last_wifi_attempt = now
        if wifi_status != old:
            try:
                mqtt_publish(TOPIC_WIFI, wifi_status, retain=True)
            except Exception:
                pass
    except Exception as e:
        print("WiFi connect attempt failed:", e)
        wifi_status = "offline"
        wifi_ok = False
        if wifi_status != old:
            try:
                mqtt_publish(TOPIC_WIFI, wifi_status, retain=True)
            except Exception:
                pass
    return False


def mqtt_callback(topic, msg):
    global state, _current_rpm, FORWARD_DURATION_S, REVERSE_DURATION_S, _pwm
    try:
        t = topic.decode() if isinstance(topic, bytes) else str(topic)
        s = msg.decode() if isinstance(msg, bytes) else str(msg)
        print("MQTT in", t, s)
        if s.strip().lower() == "start":
            # Mirror the physical START button: start or restart the forward/reverse
            # sequence unless we're in an emergency state.
            if state == "emergency":
                print("MQTT START received but system in EMERGENCY - ignored")
            else:
                try:
                    # ensure any previous pwm is stopped and start fresh
                    stop_pwm()
                except Exception:
                    pass
                state = "run"
                try:
                    mqtt_publish(TOPIC_STATUS, state, retain=True)
                except Exception:
                    pass
                print("MQTT START received - running forward/reverse sequence")
                try:
                    _pwm = run_speed_sequence()
                except Exception as e:
                    print("run sequence failed from mqtt start", e)
        elif s.strip().lower() == "stop":
            # Stop should fully reset the running sequence similar to pressing a hardware stop.
            stop_pwm()
            state = "idle"
            # publish updated status
            try:
                mqtt_publish(TOPIC_STATUS, state, retain=True)
            except Exception:
                pass
        elif s.strip().lower() == "emergency":
            emergency_stop()
        elif s.strip().lower() in ("clear_emergency", "disable_emergency", "clear"):
            # Allow remote clearing of emergency state
            if state == "emergency":
                print("MQTT clear emergency request")
                state = "idle"
                try:
                    mqtt_publish(TOPIC_STATUS, state, retain=True)
                except Exception:
                    pass
        elif s.strip().lower() == "tare":
            tare_all()
        else:
            try:
                data = ujson.loads(s)
                cmd = data.get("cmd")
                if cmd == "set_rpm":
                    r = int(data.get("rpm", _current_rpm))
                    _current_rpm = max(MIN_RPM, min(MAX_RPM, r))
                    mqtt_publish(TOPIC_RPM, _current_rpm, retain=True)
                elif cmd == "set_dir":
                    d = data.get("dir", "FWD")
                    if str(d).upper() == "REV":
                        dir_pin.value(0)
                    else:
                        dir_pin.value(1)
                    mqtt_publish(TOPIC_DIR, d, retain=True)
                elif cmd == "set_cycle":
                    # Accept JSON like: {"cmd":"set_cycle","forward":7,"reverse":7}
                    try:
                        fwd = float(data.get("forward", FORWARD_DURATION_S))
                        rev = float(data.get("reverse", REVERSE_DURATION_S))
                        # sanitize non-negative
                        if fwd < 0:
                            fwd = FORWARD_DURATION_S
                        if rev < 0:
                            rev = REVERSE_DURATION_S
                        FORWARD_DURATION_S = fwd
                        REVERSE_DURATION_S = rev
                        # publish updated cycle config retained
                        try:
                            mqtt_publish(TOPIC_CYCLE, ujson.dumps({"forward": FORWARD_DURATION_S, "reverse": REVERSE_DURATION_S}), retain=True)
                        except Exception:
                            pass
                    except Exception:
                        print("invalid set_cycle payload")
                elif cmd == "get_status":
                    try:
                        w, _, _ = get_weight() if hx_modules else (0.0, [], 0)
                    except Exception:
                        w = 0.0
                    try:
                        d = measure_distance()
                    except Exception:
                        d = None
                    mqtt_publish(TOPIC_WEIGHT, "{:.2f}".format(w))
                    mqtt_publish(TOPIC_DISTANCE, "{:.1f}".format(d) if d is not None else "None")
                    mqtt_publish(TOPIC_STATUS, state, retain=True)
                    mqtt_publish(TOPIC_RPM, _current_rpm, retain=True)
                    mqtt_publish(TOPIC_DIR, "FWD" if dir_pin.value() else "REV", retain=True)
                    mqtt_publish(TOPIC_WIFI, wifi_status, retain=True)
                    mqtt_publish(TOPIC_CYCLE, ujson.dumps({"forward": FORWARD_DURATION_S, "reverse": REVERSE_DURATION_S}), retain=True)
            except Exception:
                print("Unknown command payload")
    except Exception as e:
        print("mqtt callback error", e)


def connect_mqtt():
    global mqtt_client, last_mqtt_attempt
    try:
        if not wifi_ok:
            return False
        now = time.time()
        if now - last_mqtt_attempt < MQTT_RETRY_INTERVAL_S:
            return False
        last_mqtt_attempt = now

        if MQTT_USER and MQTT_PASS:
            mqtt_client = MQTTClient(CLIENT_ID, MQTT_BROKER, port=MQTT_PORT, user=MQTT_USER, password=MQTT_PASS)
        else:
            mqtt_client = MQTTClient(CLIENT_ID, MQTT_BROKER, port=MQTT_PORT)
        mqtt_client.set_callback(mqtt_callback)

        try:
            if hasattr(mqtt_client, 'set_last_will'):
                try:
                    mqtt_client.set_last_will(TOPIC_STATUS, 'offline', retain=True)
                except Exception:
                    pass
        except Exception:
            pass

        mqtt_client.connect()
        mqtt_client.subscribe(TOPIC_COMMAND)
        print("MQTT connected, subscribed to", TOPIC_COMMAND)

        # publish retained state so dashboards see current values on connect
        mqtt_publish(TOPIC_STATUS, "online", retain=True)
        mqtt_publish(TOPIC_RPM, _current_rpm, retain=True)
        mqtt_publish(TOPIC_DIR, "FWD" if dir_pin.value() else "REV", retain=True)
        # publish wifi state and cycle config on MQTT connect
        mqtt_publish(TOPIC_WIFI, wifi_status, retain=True)
        try:
            mqtt_publish(TOPIC_CYCLE, ujson.dumps({"forward": FORWARD_DURATION_S, "reverse": REVERSE_DURATION_S}), retain=True)
        except Exception:
            pass
        return True
    except Exception as e:
        print("MQTT connect failed:", e)
        mqtt_client = None
        return False


def mqtt_publish(topic, payload, retain=False):
    try:
        if mqtt_client:
            try:
                mqtt_client.publish(topic, str(payload), retain=bool(retain))
            except TypeError:
                mqtt_client.publish(topic, str(payload))
            except Exception:
                mqtt_client.publish(topic, str(payload))
    except Exception as e:
        print("mqtt_publish err", e)


# ---------- STARTUP ----------
try:
    if hx_modules:
        tare_all()
except Exception as e:
    print("Initial tare failed:", e)

init_wlan()
ensure_wifi()

if wifi_ok:
    connect_mqtt()

led_green.value(1)
print("System ready - entering main loop")
_last_publish = time.ticks_ms()
_pwm = None

# ---------- MAIN LOOP ----------
while True:
    try:
        # Keep WiFi reconnecting in background
        ensure_wifi()

        # Keep MQTT connected when WiFi available
        if wifi_ok and mqtt_client is None:
            connect_mqtt()

        # handle mqtt in background
        if mqtt_client:
            try:
                mqtt_client.check_msg()
            except Exception as e:
                print("mqtt check_msg error", e)
                try:
                    mqtt_client.disconnect()
                except Exception:
                    pass
                mqtt_client = None
                time.sleep(1)

        weight, raws, used = get_weight() if hx_modules else (0.0, [], 0)
        distance = measure_distance()

        display_status(state, weight, distance)
        print("W={:.2f}kg D={} state={} wifi={} used={}".format(weight, distance, state, wifi_status, used))

        now = time.ticks_ms()
        if time.ticks_diff(now, _last_publish) >= PUBLISH_INTERVAL_MS:
            mqtt_publish(TOPIC_WEIGHT, "{:.2f}".format(weight))
            mqtt_publish(TOPIC_DISTANCE, "{:.1f}".format(distance) if distance is not None else "None")
            mqtt_publish(TOPIC_STATUS, state)
            mqtt_publish(TOPIC_RPM, _current_rpm)
            mqtt_publish(TOPIC_DIR, "FWD" if dir_pin.value() else "REV")
            _last_publish = now

        # Emergency button immediate handling (pressing it triggers emergency)
        if not btn_emerg.value():
            emergency_stop()

        # State machine
        if state in ("idle", "done"):
            display_status("Press START", weight, distance)
            if not btn_start.value():
                # debounce
                time.sleep_ms(50)
                if not btn_start.value():
                    state = "run"
                    print("Local START pressed - running forward/reverse sequence")
                    _pwm = run_speed_sequence()
        elif state == "run":
            if (not FORCE_RUN) and weight >= THRESHOLD_KG:
                stop_pwm()
                led_green.value(0)
                led_red.value(1)
                buzzer.value(1)
                state = "done"
        elif state == "done":
            display_status("DONE", weight, distance)
            if not btn_start.value():
                time.sleep_ms(50)
                if not btn_start.value():
                    buzzer.value(0)
                    led_red.value(0)
                    led_green.value(0)
                    tare_all()
                    time.sleep_ms(200)
                    led_green.value(1)
                    _pwm = run_speed_sequence()
                    state = "run"

        time.sleep_ms(50)

    except KeyboardInterrupt:
        print("KeyboardInterrupt - cleanup")
        try:
            stop_pwm()
        except Exception:
            pass
        try:
            mqtt_publish(TOPIC_STATUS, "offline", retain=True)
        except Exception:
            pass
        break
    except Exception as e:
        print("Main loop exception:", e)
        time.sleep(0.5)
