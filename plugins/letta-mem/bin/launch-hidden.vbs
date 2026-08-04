Option Explicit

Dim shell, commandLine, index, argument
Set shell = CreateObject("WScript.Shell")
commandLine = ""

For index = 0 To WScript.Arguments.Count - 1
  argument = WScript.Arguments(index)
  If Len(commandLine) > 0 Then commandLine = commandLine & " "
  commandLine = commandLine & Chr(34) & Replace(argument, Chr(34), Chr(34) & Chr(34)) & Chr(34)
Next

Call shell.Run(commandLine, 0, False)
