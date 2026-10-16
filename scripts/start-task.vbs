Option Explicit

Dim shell, files, root, command
If WScript.Arguments.Count <> 1 Then WScript.Quit 2
Set shell = CreateObject("WScript.Shell")
Set files = CreateObject("Scripting.FileSystemObject")
root = files.GetParentFolderName(files.GetParentFolderName(WScript.ScriptFullName))
command = Quote(WScript.Arguments(0)) & " -NoProfile -NonInteractive -ExecutionPolicy Bypass -File " & _
    Quote(files.BuildPath(root, "scripts\start-hidden.ps1"))
WScript.Quit shell.Run(command, 0, True)

Function Quote(value)
    Quote = Chr(34) & value & Chr(34)
End Function
