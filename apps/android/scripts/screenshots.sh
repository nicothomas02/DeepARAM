#!/bin/sh
# Phone and tablet screenshots of the debug app on a running emulator, into screenshots/ (CI keeps them).
# They are for people to look at, not a test: the emulator's software GPU sometimes drops adb while
# drawing the site, so a missed screenshot is skipped rather than failing the run.
mkdir -p screenshots
adb install -r app/build/outputs/apk/debug/app-debug.apk || exit 0

shot() {
  adb shell am start -W -n com.deeparam.app/.MainActivity -a android.intent.action.VIEW -d "$2" || return 0
  sleep 20
  adb shell screencap -p "/sdcard/$1.png" && adb pull "/sdcard/$1.png" "screenshots/$1.png"
  return 0
}

shot phone-home https://deeparam.com/
shot phone-tier-list https://deeparam.com/tier-list
adb shell wm size 2560x1600 && adb shell wm density 320 && shot tablet-tier-list https://deeparam.com/tier-list
adb shell wm size reset
adb shell wm density reset
exit 0
