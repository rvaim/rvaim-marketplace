using System;
using System.Collections.Generic;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;

internal static class Program
{
    private const uint CreateNoWindow = 0x08000000;
    private const uint CreateUnicodeEnvironment = 0x00000400;
    private const uint DuplicateSameAccess = 0x00000002;
    private const uint GenericRead = 0x80000000;
    private const uint GenericWrite = 0x40000000;
    private const uint FileShareRead = 0x00000001;
    private const uint FileShareWrite = 0x00000002;
    private const uint OpenExisting = 3;
    private const uint FileAttributeNormal = 0x00000080;
    private const uint StartfUseShowWindow = 0x00000001;
    private const uint StartfUseStdHandles = 0x00000100;
    private const ushort SwHide = 0;
    private const uint Infinite = 0xFFFFFFFF;
    private const int StdInputHandle = -10;
    private const int StdOutputHandle = -11;
    private const int StdErrorHandle = -12;
    private static readonly IntPtr InvalidHandleValue = new IntPtr(-1);

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct StartupInfo
    {
        public int cb;
        public string reserved;
        public string desktop;
        public string title;
        public uint x;
        public uint y;
        public uint xSize;
        public uint ySize;
        public uint xCountChars;
        public uint yCountChars;
        public uint fillAttribute;
        public uint flags;
        public ushort showWindow;
        public ushort reserved2;
        public IntPtr reservedPointer;
        public IntPtr stdInput;
        public IntPtr stdOutput;
        public IntPtr stdError;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct ProcessInformation
    {
        public IntPtr process;
        public IntPtr thread;
        public uint processId;
        public uint threadId;
    }

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool CreateProcess(
        string applicationName,
        StringBuilder commandLine,
        IntPtr processAttributes,
        IntPtr threadAttributes,
        bool inheritHandles,
        uint creationFlags,
        IntPtr environment,
        string currentDirectory,
        ref StartupInfo startupInfo,
        out ProcessInformation processInformation);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern IntPtr GetCurrentProcess();

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern IntPtr GetStdHandle(int standardHandle);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool DuplicateHandle(
        IntPtr sourceProcess,
        IntPtr sourceHandle,
        IntPtr targetProcess,
        out IntPtr targetHandle,
        uint desiredAccess,
        bool inheritHandle,
        uint options);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern IntPtr CreateFile(
        string fileName,
        uint desiredAccess,
        uint shareMode,
        IntPtr securityAttributes,
        uint creationDisposition,
        uint flagsAndAttributes,
        IntPtr templateFile);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern uint WaitForSingleObject(IntPtr handle, uint milliseconds);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool GetExitCodeProcess(IntPtr process, out uint exitCode);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool CloseHandle(IntPtr handle);

    [STAThread]
    private static int Main(string[] arguments)
    {
        string bootstrapPath = Path.GetFullPath(Path.Combine(
            AppDomain.CurrentDomain.BaseDirectory,
            "bootstrap.cjs"));
        if (!File.Exists(bootstrapPath)) return 1;

        var inheritedHandles = new List<IntPtr>();
        ProcessInformation process = new ProcessInformation();
        try
        {
            IntPtr input = PrepareStandardHandle(
                StdInputHandle,
                GenericRead,
                inheritedHandles);
            IntPtr output = PrepareStandardHandle(
                StdOutputHandle,
                GenericWrite,
                inheritedHandles);
            IntPtr error = PrepareStandardHandle(
                StdErrorHandle,
                GenericWrite,
                inheritedHandles);

            var startup = new StartupInfo();
            startup.cb = Marshal.SizeOf(typeof(StartupInfo));
            startup.flags = StartfUseShowWindow | StartfUseStdHandles;
            startup.showWindow = SwHide;
            startup.stdInput = input;
            startup.stdOutput = output;
            startup.stdError = error;

            var commandLine = new StringBuilder();
            AppendArgument(commandLine, "node.exe");
            AppendArgument(commandLine, bootstrapPath);
            foreach (string argument in arguments)
            {
                AppendArgument(commandLine, argument);
            }

            bool created = CreateProcess(
                null,
                commandLine,
                IntPtr.Zero,
                IntPtr.Zero,
                true,
                CreateNoWindow | CreateUnicodeEnvironment,
                IntPtr.Zero,
                null,
                ref startup,
                out process);
            if (!created) return 1;

            WaitForSingleObject(process.process, Infinite);
            uint exitCode;
            return GetExitCodeProcess(process.process, out exitCode)
                ? unchecked((int)exitCode)
                : 1;
        }
        finally
        {
            if (process.thread != IntPtr.Zero) CloseHandle(process.thread);
            if (process.process != IntPtr.Zero) CloseHandle(process.process);
            foreach (IntPtr handle in inheritedHandles)
            {
                CloseHandle(handle);
            }
        }
    }

    private static IntPtr PrepareStandardHandle(
        int standardHandle,
        uint fallbackAccess,
        ICollection<IntPtr> handlesToClose)
    {
        IntPtr source = GetStdHandle(standardHandle);
        if (IsUsableHandle(source))
        {
            IntPtr duplicate;
            IntPtr process = GetCurrentProcess();
            if (DuplicateHandle(
                process,
                source,
                process,
                out duplicate,
                0,
                true,
                DuplicateSameAccess))
            {
                handlesToClose.Add(duplicate);
                return duplicate;
            }
        }

        IntPtr fallback = CreateFile(
            "NUL",
            fallbackAccess,
            FileShareRead | FileShareWrite,
            IntPtr.Zero,
            OpenExisting,
            FileAttributeNormal,
            IntPtr.Zero);
        if (IsUsableHandle(fallback)) handlesToClose.Add(fallback);
        return fallback;
    }

    private static bool IsUsableHandle(IntPtr handle)
    {
        return handle != IntPtr.Zero && handle != InvalidHandleValue;
    }

    private static void AppendArgument(StringBuilder commandLine, string value)
    {
        if (commandLine.Length > 0) commandLine.Append(' ');
        commandLine.Append(QuoteArgument(value));
    }

    private static string QuoteArgument(string value)
    {
        if (value.Length > 0 && value.IndexOfAny(new[] { ' ', '\t', '\n', '\v', '"' }) < 0)
        {
            return value;
        }

        var quoted = new StringBuilder();
        quoted.Append('"');
        int backslashes = 0;
        foreach (char character in value)
        {
            if (character == '\\')
            {
                backslashes += 1;
                continue;
            }
            if (character == '"')
            {
                quoted.Append('\\', backslashes * 2 + 1);
                quoted.Append('"');
                backslashes = 0;
                continue;
            }
            quoted.Append('\\', backslashes);
            quoted.Append(character);
            backslashes = 0;
        }
        quoted.Append('\\', backslashes * 2);
        quoted.Append('"');
        return quoted.ToString();
    }
}
