; Puts the app's bin folder (otea.cmd for cmd and PowerShell, otea for Git Bash) on the user's PATH
; when Otea is installed, and takes it off when Otea is uninstalled, but not when an update
; replaces it. path.ps1 changes only the user's PATH, only that entry. It is packed into the
; installer and the uninstaller themselves: when the uninstaller runs, the app's files may be gone.
;
; While it writes the app's files the installer keeps a flag, "installing", in Otea's data folder
; (%APPDATA%\Otea, the app's userData), outside the install folder an update empties first. An app
; started meanwhile (from a shell that did not wait for a silent install, or by hand) waits for the
; flag to go instead of loading files only half written (src/install-wait.ts).

!macro oteaPath ACTION
  InitPluginsDir
  File "/oname=$PLUGINSDIR\otea-path.ps1" "${BUILD_RESOURCES_DIR}\path.ps1"
  nsExec::ExecToLog '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\otea-path.ps1" -Action ${ACTION} -Dir "$INSTDIR\resources\bin"'
  Pop $0
!macroend

; electron-builder names a per-user one-click install folder after the package (otea-desktop), not
; the product: only a per-machine or assisted installer uses the product name. So the default
; folder is set here to Programs\Otea. A folder an earlier install chose (the registry's
; InstallLocation) and one given with /D are kept as they are, so an update never moves the app
; and the uninstaller, the shortcuts and the PATH entry keep pointing at the same place.
!macro oteaInstallDir
  ReadRegStr $0 HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation
  ${If} $0 == ""
  ${AndIf} $INSTDIR == "$LOCALAPPDATA\Programs\${APP_FILENAME}"
    StrCpy $INSTDIR "$LOCALAPPDATA\Programs\${PRODUCT_FILENAME}"
  ${EndIf}
!macroend

!macro customInit
  !insertmacro oteaInstallDir
  CreateDirectory "$APPDATA\Otea"
  FileOpen $0 "$APPDATA\Otea\installing" w
  FileClose $0
!macroend

; The last step of the install, after every file, the registry and the shortcuts.
!macro customInstall
  !insertmacro oteaPath add
  Delete "$APPDATA\Otea\installing"
!macroend

!macro customUnInstall
  ${ifNot} ${isUpdated}
    !insertmacro oteaPath remove
  ${endIf}
!macroend
