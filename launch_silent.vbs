Dim objShell, scriptDir
Set objShell = CreateObject("WScript.Shell")
scriptDir = Left(WScript.ScriptFullName, InStrRev(WScript.ScriptFullName, "\") - 1)

' Kill any existing server on port 5000
objShell.Run "cmd /c for /f ""tokens=5"" %a in ('netstat -aon ^| find "":5000"" ^| find ""LISTENING""') do taskkill /F /PID %a", 0, True

' Start Flask silently (no window)
objShell.Environment("Process")("PYTHONIOENCODING") = "utf-8"
objShell.Environment("Process")("PYTHONUTF8") = "1"
objShell.CurrentDirectory = scriptDir
objShell.Run "pythonw app.py", 0, False

' Wait then open browser
WScript.Sleep 2000
objShell.Run "http://127.0.0.1:5000"
