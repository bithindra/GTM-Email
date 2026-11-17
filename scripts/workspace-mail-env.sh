#!/bin/bash
# Move GTM Flow and XamBaaz off Hostinger mail (it ends 24 Nov 2026) onto the Google
# Workspace account info@brandvibe.co.in, whose aliases include partnerships@xambaaz.com,
# hello@xambaaz.com and hello@brandvibe.co.in.
#
# Asks for an App Password of info@brandvibe.co.in (myaccount.google.com/apppasswords),
# checks it against imap.gmail.com, then writes it to Vercel. The password is never
# printed, never put in a command line, and never written to disk.
#
# Takes effect at each project's next production deploy.
set -euo pipefail

GTM="$HOME/Documents/Claude/gtm-flow"
XB="$HOME/Documents/Claude/scholarrank"
ACCOUNT="info@brandvibe.co.in"

# Google shows the password as four groups of four, and a copy often carries a line break
# partway through, so keep reading lines until all 16 letters are in.
printf "App Password for %s (16 letters, spaces and line breaks are fine): " "$ACCOUNT"
PW=""
while [ "${#PW}" -lt 16 ]; do
  IFS= read -rs LINE || break
  LINE="${LINE//[[:space:]]/}"
  PW="$PW$LINE"
  [ "${#PW}" -lt 16 ] && [ -n "$LINE" ] && printf "\n  got %s of 16 letters, paste or type the rest: " "${#PW}"
done
echo
[ "${#PW}" -eq 16 ] || { echo "That is ${#PW} characters, expected 16. Nothing changed."; exit 1; }

echo "Checking the password with imap.gmail.com…"
PW="$PW" ACCOUNT="$ACCOUNT" python3 -I -c '
import imaplib, os, sys
try:
    m = imaplib.IMAP4_SSL("imap.gmail.com", 993); m.login(os.environ["ACCOUNT"], os.environ["PW"]); m.logout()
except Exception as e:
    sys.exit(f"Sign-in failed: {e}. Nothing changed.")
print("Sign-in OK.")'

setv() { # dir name value — replaces the Production value
  vercel env rm "$2" production --yes --cwd "$1" >/dev/null 2>&1 || true
  printf %s "$3" | vercel env add "$2" production --cwd "$1" >/dev/null
  echo "  set $2"
}

echo "GTM Flow (slots 3 partnerships@xambaaz.com and 4 hello@brandvibe.co.in):"
for n in 3 4; do
  setv "$GTM" "SMTP_HOST_$n" smtp.gmail.com
  setv "$GTM" "LOGIN_USER_$n" "$ACCOUNT"
  setv "$GTM" "SMTP_PASS_$n" "$PW"
done

echo "XamBaaz (STOP-reply reader):"
setv "$XB" SUPPORT_IMAP_USER "$ACCOUNT"
setv "$XB" SUPPORT_IMAP_PASS "$PW"
vercel env rm HOSTINGER_SMTP_PASS production --yes --cwd "$XB" >/dev/null 2>&1 && echo "  removed HOSTINGER_SMTP_PASS (Hostinger send path off)" || echo "  HOSTINGER_SMTP_PASS was already gone"

unset PW
echo "Done. Both take effect at the next production deploy."
