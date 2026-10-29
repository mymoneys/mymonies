# Running the Akiba demo

## Mirror the phone on the laptop (scrcpy)

Install once: `sudo apt install -y scrcpy` (Ubuntu's 1.25 uses the system `adb`).
Connect the phone over USB with USB debugging on, then:

```sh
scrcpy --window-title "MyMonies – Akiba Agent" --max-size 1280 --stay-awake --show-touches --max-fps 30
```

- `--show-touches` draws a dot where you tap, so the audience can follow.
- `--stay-awake` keeps the screen on while plugged in.
- Shortcuts: `Alt+F` full screen, `Alt+G` 1:1 size, `Alt+←/→` rotate.
- Clicking in the window needs **Developer options → USB debugging (Security settings)** on Xiaomi phones.
  Tapping the phone itself always works, and the fingerprint has to be done on the phone anyway.

## Before the demo (internet on)

1. Build with `EXPO_PUBLIC_DEMO_MODE=1` and `EXPO_PUBLIC_WALLET_SIGNER=laptop` in `.env`.
2. Akiba tab: confirm the model is downloaded ("Qwen3 0.6B Instruct (Q4) · works offline").
3. Tap **Reset demo**.
4. `npm run wallet -- balance`: spending #0 needs more than the sweep (about 66 USDt).
   Top up with `npm run wallet -- refill <amount>` or the Candide faucet.

## Flow

1. Airplane mode on (Wi-Fi off too).
2. **Load 4 months** (once only: it resets "Akiba on since", so a later salary SMS would be ignored).
3. **+ salary SMS** → "Akiba is thinking on this phone…" → proposal card, "suggested by the AI". Open "Why this amount?".
4. **+ loan SMS** → "Save nothing".
5. Profile → Language → Kiswahili.
6. Approve with fingerprint → "Approved — sign it on the laptop".
7. Turn **Wi-Fi on** (airplane mode off alone isn't enough on this phone).
   Run the `npm run wallet -- sweep …` command shown in the app. The card becomes "Saved ✓" within about 15 s.

The KES → USDt conversion is simulated at a fixed, dated demo rate. Say so in the demo.
