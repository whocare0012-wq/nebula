!include "StrFunc.nsh"
!ifdef BUILD_UNINSTALLER
  ${UnStrRep}
  !define T3StrRep '${UnStrRep}'
!else
  ${StrRep}
  !define T3StrRep '${StrRep}'
!endif

!macro customAppRunningMessages
  Push $0
  Push $1
  ${If} $IsPowerShellAvailable == 0
    System::Call 'kernel32::SetEnvironmentVariable(t "T3CODE_INSTALL_DIR", t "$INSTDIR")'
    nsExec::ExecToStack `"$PowerShellPath" -NoProfile -NonInteractive -C "Get-CimInstance -ClassName Win32_Process | Where-Object { $$_.ExecutablePath -and [IO.Path]::GetDirectoryName($$_.ExecutablePath) -eq $$env:T3CODE_INSTALL_DIR } | ForEach-Object { [IO.Path]::GetFileNameWithoutExtension($$_.ExecutablePath) } | Where-Object { $$_ -in 'T3 Code (Alpha)', 'T3 Code (Beta)', 'T3 Code (Nightly)' } | Select-Object -First 1 | ForEach-Object { [Console]::Write($$_) }"`
    Pop $0
    Pop $1
    System::Call 'kernel32::SetEnvironmentVariable(t "T3CODE_INSTALL_DIR", p 0)'
    ${If} $0 == 0
      ${If} $1 == "T3 Code (Alpha)"
      ${OrIf} $1 == "T3 Code (Beta)"
      ${OrIf} $1 == "T3 Code (Nightly)"
        ${T3StrRep} $appRunningMessage $appRunningMessage "${PRODUCT_NAME}" $1
        ${T3StrRep} $appClosingMessage $appClosingMessage "${PRODUCT_NAME}" $1
        ${T3StrRep} $appCannotBeClosedMessage $appCannotBeClosedMessage "${PRODUCT_NAME}" $1
      ${EndIf}
    ${EndIf}
  ${EndIf}
  Pop $1
  Pop $0
!macroend

!macro customInstall
  !ifndef DO_NOT_CREATE_START_MENU_SHORTCUT
    ${IfNot} ${FileExists} "$newStartMenuLink"
      !insertmacro createMenuDirectory
      CreateShortCut "$newStartMenuLink" "$appExe" "" "$appExe" 0 "" "" "${APP_DESCRIPTION}"
      ClearErrors
      WinShell::SetLnkAUMI "$newStartMenuLink" "${APP_ID}"
    ${EndIf}
  !endif
!macroend

; Nebula 1.0.8 and earlier installed under T3 Code's app id. Remove that registration (keeping
; app data, which the app moves on first launch) so the two never share an uninstall entry or
; folder. A real T3 Code install under that id is left alone.
!define NEBULA_LEGACY_GUID "e9197887-efb3-55e0-985e-d6d3b5dd594a"
!macro customInit
  Push $0
  Push $1
  ReadRegStr $0 HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${NEBULA_LEGACY_GUID}" "DisplayName"
  StrCpy $0 $0 7
  ReadRegStr $1 HKCU "Software\${NEBULA_LEGACY_GUID}" "InstallLocation"
  ${If} $0 == "Nebula "
  ${AndIf} $1 != ""
  ${AndIf} ${FileExists} "$1\Uninstall Nebula.exe"
    InitPluginsDir
    CopyFiles /SILENT /FILESONLY "$1\Uninstall Nebula.exe" "$PLUGINSDIR\nebula-legacy-uninstaller.exe"
    ExecWait '"$PLUGINSDIR\nebula-legacy-uninstaller.exe" /S /KEEP_APP_DATA /currentuser --updated _?=$1'
    Delete "$PLUGINSDIR\nebula-legacy-uninstaller.exe"
    ; Run with _?=, the uninstaller cannot delete itself or its folder.
    Delete "$1\Uninstall Nebula.exe"
    RMDir "$1"
  ${EndIf}
  Pop $1
  Pop $0
!macroend
