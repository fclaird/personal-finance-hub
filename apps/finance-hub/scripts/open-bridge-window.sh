#!/bin/zsh
# Close Financial Bridge tabs (not other tabs) and open one full-screen window.
# Chrome is preferred. Safari is the fallback. Other browsers are left alone.
set -eu

ORIGIN="${1:-https://127.0.0.1:3000}"
HOSTPORT="${ORIGIN#*://}"
HOSTPORT="${HOSTPORT%%/*}"

chrome_script=$(cat <<APPLESCRIPT
on closeHubTabs()
  tell application "Google Chrome"
    if (count of windows) is 0 then return
    set windowCount to count of windows
    repeat with w from windowCount to 1 by -1
      set tabCount to count of tabs of window w
      repeat with t from tabCount to 1 by -1
        try
          set tabUrl to URL of tab t of window w
          if tabUrl contains "${HOSTPORT}" then
            if tabCount is 1 then
              close window w
              exit repeat
            else
              close tab t of window w
              set tabCount to tabCount - 1
            end if
          end if
        end try
      end repeat
    end repeat
  end tell
end closeHubTabs

closeHubTabs()
tell application "Google Chrome"
  make new window
  set URL of active tab of front window to "${ORIGIN}/"
  activate
end tell
delay 0.4
tell application "System Events"
  tell process "Google Chrome"
    set frontmost to true
    try
      set isFull to value of attribute "AXFullScreen" of window 1
    on error
      set isFull to false
    end try
    if isFull is false then keystroke "f" using {control down, command down}
  end tell
end tell
APPLESCRIPT
)

safari_script=$(cat <<APPLESCRIPT
on closeHubTabs()
  tell application "Safari"
    if (count of windows) is 0 then return
    set windowCount to count of windows
    repeat with w from windowCount to 1 by -1
      set tabCount to count of tabs of window w
      repeat with t from tabCount to 1 by -1
        try
          set tabUrl to URL of tab t of window w
          if tabUrl contains "${HOSTPORT}" then
            if tabCount is 1 then
              close window w
              exit repeat
            else
              close tab t of window w
              set tabCount to tabCount - 1
            end if
          end if
        end try
      end repeat
    end repeat
  end tell
end closeHubTabs

closeHubTabs()
tell application "Safari"
  make new document with properties {URL:"${ORIGIN}/"}
  activate
end tell
delay 0.4
tell application "System Events"
  tell process "Safari"
    set frontmost to true
    try
      set isFull to value of attribute "AXFullScreen" of window 1
    on error
      set isFull to false
    end try
    if isFull is false then keystroke "f" using {control down, command down}
  end tell
end tell
APPLESCRIPT
)

if [[ "$(uname)" != "Darwin" ]]; then
  exit 0
fi

if osascript -e 'id of application "Google Chrome"' >/dev/null 2>&1; then
  osascript -e "$chrome_script"
  exit 0
fi

if osascript -e 'id of application "Safari"' >/dev/null 2>&1; then
  osascript -e "$safari_script"
  exit 0
fi

open "$ORIGIN/"
