# axiom-build-monitor

A live panel beside the chat that shows what the Axiom build is doing right now: the current step and why, the list of steps with their state, which helper agents are working and what they reported, how much of the real AI testing budget is used, test results, what needs the founder, the next stop, and recent events.

It reads one file, `/Users/rafayessani/AXIOM/tasks/build_status.json`, every few seconds. The build session updates that file after every step. Open the panel with `/axiom-build`. It opens by itself when a session starts.
