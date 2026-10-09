---
covers: []
reviewed: 2026-10-05
---

# Restaurant Playbook: Operating Hours & Availability

This playbook tests store trading schedules, instant order acceptance toggling, and automated offline state transitions.

---

## 1. Operating Hours Overview

1. **Browser action**:
   - Open `/hours` as restaurant staff, manager, or owner.
2. **Visible assertion**:
   - Page header displays **Hours & availability**.
   - Current operational status card displays open state (e.g. `Open`, `Closed — outside trading hours`, or `Paused`).
   - The weekly schedule grid displays open and close times for all seven days of the week.

---

## 2. Toggle Accepting Orders & Keyboard Focus

1. **Browser action**:
   - Focus the **Accepting orders** toggle using the Tab key.
2. **Visible assertion**:
   - The two-layer focus ring (the shared focus style) is clearly visible surrounding the switch component.
3. **Browser action**:
   - Press the Space key or click the switch to disable order acceptance.
4. **Visible assertion**:
   - State indicator updates to `Closed — toggled off`.
   - The active pulse glow settles to slate (an operational state, never red, per [Design Rule 9](../../../AGENTS.md#3-non-negotiable-invariants)).
5. **Browser action**:
   - Toggle the switch back to active.
6. **Visible assertion**:
   - State updates to `Open`.

---

## 3. Weekly Schedule Configuration

1. **Browser action**:
   - Select a day (e.g. `Monday`) and update opening time to `11:00 AM` and closing time to `10:00 PM`.
   - Click **Save schedule**.
2. **Visible assertion**:
   - Updated operating window is reflected on the day row.
   - Customers browsing outside these hours receive schedule messaging during checkout.
