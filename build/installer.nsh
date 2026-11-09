; ENiShare NSIS additions: an inbound firewall rule for private networks only,
; so the iPhone can reach the app without Windows Firewall prompts. Removed on uninstall.
!macro customInstall
  nsExec::Exec 'netsh advfirewall firewall delete rule name="ENiShare"'
  nsExec::Exec 'netsh advfirewall firewall add rule name="ENiShare" dir=in action=allow program="$INSTDIR\ENiShare.exe" enable=yes profile=private protocol=TCP'
!macroend

!macro customUnInstall
  nsExec::Exec 'netsh advfirewall firewall delete rule name="ENiShare"'
!macroend
