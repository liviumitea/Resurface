#!/usr/bin/env bash
# Read-only smoke pass over the main screens on a booted iOS simulator with a Release build installed.
# It navigates Today, Library (each status tab, Manage categories), Settings (up to the restore
# warning, which it cancels) and the capture choice, and never saves, deletes or changes anything. Requires AXe (https://github.com/cameroncooke/AXe) and Node 24.
#   scripts/smoke-ios.sh [simulator-udid]
# Onboarding must already be complete on that simulator.
set -euo pipefail

UDID="${1:-$(xcrun simctl list devices booted | grep -Eo '[0-9A-F-]{36}' | head -1)}"
BUNDLE="app.resurface.mobile"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
[ -n "$UDID" ] || { echo "No booted simulator."; exit 1; }

STRINGS="$(cd "$ROOT" && node --import tsx scripts/smoke-strings.ts)"
string() { python3 -c 'import json,sys; print(json.loads(sys.argv[1])[sys.argv[2]][sys.argv[3]])' "$STRINGS" "$LANGUAGE" "$1"; }
on_screen() { axe describe-ui --udid "$UDID" 2>/dev/null | python3 -c '
import json, sys
want = sys.argv[1]
def walk(node):
    if (node.get("AXLabel") or "") == want: return True
    return any(walk(child) for child in node.get("children") or [])
tree = json.load(sys.stdin)
sys.exit(0 if any(walk(node) for node in (tree if isinstance(tree, list) else [tree])) else 1)' "$1"; }
wait_for() { for _ in $(seq 1 "${2:-40}"); do on_screen "$1" && return 0; sleep 0.25; done; return 1; }

PASSED=0; FAILED=0
step() {
  local name="$1"; shift
  if "$@"; then echo "  pass  $name"; PASSED=$((PASSED + 1)); else echo "  FAIL  $name"; FAILED=$((FAILED + 1)); fi
}
# Taps by translated label once the screen has settled; a tap during a transition can be lost.
tap() { axe tap --label "$1" --wait-timeout 5 --pre-delay 0.6 --tap-style physical --udid "$UDID" >/dev/null 2>&1; }
# Taps until the expected screen appears (at most three times). Right after launch the app is still
# loading and planning reminders, and an early tap can be dropped.
go_until() { for _ in 1 2 3; do tap "$1"; wait_for "$2" 16 && return 0; done; return 1; }
go() { go_until "$(string "$1")" "$(string "$2")"; }
# Only Today shows the brand as its header; its Settings button shares a label with the Settings title.
TODAY_HEADER="resurface."
go_today() { go_until "$(string "$1")" "$TODAY_HEADER"; }
scroll() { for _ in 1 2 3; do axe swipe --start-x 200 --start-y "$1" --end-x 200 --end-y "$2" --udid "$UDID" >/dev/null 2>&1; sleep 0.4; done; }
# Shows the replace-everything warning and is then cancelled; no file is picked.
# Scrolls in small steps until an element with this label is fully on screen (above the bottom edge).
visible() { axe describe-ui --udid "$UDID" 2>/dev/null | python3 -c '
import json, sys
want = sys.argv[1]
def walk(node):
    frame = node.get("frame") or {}
    if (node.get("AXLabel") or "") == want and 100 <= frame.get("y", -1) <= 760: return True
    return any(walk(child) for child in node.get("children") or [])
tree = json.load(sys.stdin)
sys.exit(0 if any(walk(node) for node in (tree if isinstance(tree, list) else [tree])) else 1)' "$1"; }
scroll_to() { for _ in $(seq 1 12); do visible "$1" && return 0; axe swipe --start-x 200 --start-y 600 --end-x 200 --end-y 400 --udid "$UDID" >/dev/null 2>&1; sleep 0.4; done; return 1; }
restore_warning() { scroll_to "$(string settings.restoreBackup)" && go settings.restoreBackup backup.replaceTitle; }

xcrun simctl terminate "$UDID" "$BUNDLE" >/dev/null 2>&1 || true
xcrun simctl launch "$UDID" "$BUNDLE" >/dev/null

# The app follows its own language setting; detect it from Today's Settings button label.
LANGUAGE=""
for _ in $(seq 1 60); do
  for candidate in en ro; do
    LANGUAGE="$candidate"
    if on_screen "$(string today.settings)"; then break 2; fi
    LANGUAGE=""
  done
  sleep 0.5
done
echo "Resurface smoke on $UDID (language: ${LANGUAGE:-unknown})"
step "launch shows Today" test -n "$LANGUAGE"
[ -n "$LANGUAGE" ] || { echo "Today never appeared; is onboarding complete?"; exit 1; }

step "Library opens" go nav.library library.title
for status in paused archived active; do
  step "Library tab: $status" tap "$(string "library.status.$status")"
done
step "Library still shown" wait_for "$(string library.title)"
step "Manage categories opens" go category.manage category.screenTitle
step "categories back to Library" go common.back library.title
step "back to Today" go_today nav.today
step "Settings opens" go today.settings settings.title
step "restore warns before replacing" restore_warning
step "restore warning cancels" tap "$(string common.cancel)"
scroll 200 700
step "Settings back to Today" go_today common.back
step "capture choice opens" go nav.capture choice.title
step "capture choice cancels to Today" go_today common.cancel

echo "$PASSED passed, $FAILED failed"
[ "$FAILED" -eq 0 ]
