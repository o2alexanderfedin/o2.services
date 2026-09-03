# What real devices did — observed by the owner, 2026-09-03

**These are the owner's observations on his own hardware, not an instrumented run.** They are
recorded as that, because `RUN-06` criterion 1 refuses a green obtained from a spoofed
user-agent by name — the check is the engine, and only a real device supplies one. The
distinction that matters for anyone reading later: an owner watching a screen is a **weaker
instrument** than a spec, and a **stronger one** than an emulator. Both halves are true.

## The arrangement

The demo was opened on **three devices**, from **inside Telegram's in-app browser** and from
**ordinary browsers**, after the link was posted to a Telegram group. It worked in both.

## What was observed on the phone

| device state | what the page showed |
|---|---|
| awake, page in front | node **connected** |
| device asleep | node **disconnected** |
| device woken | node **connects again by itself** |

**The automatic reconnect is the good half and it is not nothing.** A volunteer does not have
to notice, reload, or press anything: the tab rejoins on its own. For a cohort recruited into a
phone, that is the difference between a node that participates and a node that participated
once.

## What this establishes, and what it does not

**Established:** the client runs in Telegram's in-app WebView on real hardware; a device sleep
drops the node; a wake restores it without user action.

**NOT established, and the difference is exactly what `RUN-06` criterion 2 asks about:**

- **Whether JavaScript was suspended, or the socket was merely dropped.** The observable is
  identical either way — the indicator says disconnected because the connection is gone, and
  nothing on the page distinguishes *the engine stopped* from *the network went away*. The
  automatic reconnect proves *something* ran on resume; it does not say whether that something
  had been paused or had been waiting.
- **Backgrounding while the device stays awake.** What was tested is device sleep, which
  suspends everything. Switching away from Telegram on an awake phone is a different state and
  may behave differently — that is the state a volunteer is in most of the time.
- **IndexedDB across the transition.** Not observed either way.

## The finding that is larger than the requirement

**A phone contributes while its screen is on, and not otherwise.** That is not a defect and
there is nothing to fix — it is what a mobile operating system does — but it reaches two claims
this milestone makes and neither currently accounts for it:

- **`BENCH-09`, the diurnal churn curve.** The curve is not only about when people are awake.
  It is about **screen-on time**, which is a much smaller and much spikier quantity than
  presence. A curve read as "time of day" will be read as a habit when it is partly a hardware
  behaviour.
- **The capacity claim itself.** *Usable capacity grows super-linearly with the user base* is
  stated over participants. If the cohort is mostly phones — and a Telegram-recruited cohort
  is — then the multiplier is not the number of volunteers but the number of volunteers
  **times their screen-on fraction**. Nobody has measured that fraction, and the public run is
  what can.

Recorded here rather than as a phase verdict, because `RUN-06` needs the two unestablished
readings above before it closes, and because the capacity consequence belongs to whoever plans
`BENCH-09` rather than to Phase 38.
