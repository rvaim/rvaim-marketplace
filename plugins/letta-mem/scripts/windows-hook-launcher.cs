using System;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

// 改写自 letta-ai/claude-subconscious 的 SilentLauncher.cs（MIT）。
// 上游归属与许可见插件根目录 NOTICE.md 和 LICENSE。
internal static class Program
{
    private const uint ExtendedStartupInfoPresent = 0x00080000;
    private const uint CreateNoWindow = 0x08000000;
    private const uint Infinite = 0xFFFFFFFF;
    private const int StdInputHandle = -10;
    private const int StdOutputHandle = -11;
    private const int StdErrorHandle = -12;
    private static readonly IntPtr ProcThreadAttributePseudoConsole = new IntPtr(0x00020016);

    [StructLayout(LayoutKind.Sequential)]
    private struct Coord
    {
        public short X;
        public short Y;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct SecurityAttributes
    {
        public int length;
        public IntPtr securityDescriptor;
        public bool inheritHandle;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct StartupInfo
    {
        public int cb;
        public string reserved;
        public string desktop;
        public string title;
        public int x;
        public int y;
        public int xSize;
        public int ySize;
        public int xCountChars;
        public int yCountChars;
        public int fillAttribute;
        public uint flags;
        public ushort showWindow;
        public ushort reserved2;
        public IntPtr reservedPointer;
        public IntPtr stdInput;
        public IntPtr stdOutput;
        public IntPtr stdError;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct StartupInfoEx
    {
        public StartupInfo startupInfo;
        public IntPtr attributeList;
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
        ref StartupInfoEx startupInfo,
        out ProcessInformation processInformation);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool CreatePipe(
        out IntPtr readPipe,
        out IntPtr writePipe,
        ref SecurityAttributes attributes,
        uint size);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool ReadFile(
        IntPtr file,
        byte[] buffer,
        uint bytesToRead,
        out uint bytesRead,
        IntPtr overlapped);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool WriteFile(
        IntPtr file,
        byte[] buffer,
        uint bytesToWrite,
        out uint bytesWritten,
        IntPtr overlapped);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern IntPtr GetStdHandle(int standardHandle);

    [DllImport("kernel32.dll", SetLastError = true, ExactSpelling = true)]
    private static extern int CreatePseudoConsole(
        Coord size,
        IntPtr input,
        IntPtr output,
        uint flags,
        out IntPtr pseudoConsole);

    [DllImport("kernel32.dll", SetLastError = true, ExactSpelling = true)]
    private static extern void ClosePseudoConsole(IntPtr pseudoConsole);

    [DllImport("kernel32.dll", SetLastError = true, ExactSpelling = true)]
    private static extern bool InitializeProcThreadAttributeList(
        IntPtr attributeList,
        int attributeCount,
        int flags,
        ref IntPtr size);

    [DllImport(
        "kernel32.dll",
        SetLastError = true,
        ExactSpelling = true,
        EntryPoint = "UpdateProcThreadAttribute")]
    private static extern bool UpdateProcThreadAttributeNew(
        IntPtr attributeList,
        uint flags,
        IntPtr attribute,
        IntPtr value,
        IntPtr size,
        IntPtr previousValue,
        IntPtr returnSize);

    [DllImport(
        "kernel32.dll",
        SetLastError = true,
        ExactSpelling = true,
        EntryPoint = "UpdateProcThreadAttributeList")]
    private static extern bool UpdateProcThreadAttributeOld(
        IntPtr attributeList,
        uint flags,
        IntPtr attribute,
        IntPtr value,
        IntPtr size,
        IntPtr previousValue,
        IntPtr returnSize);

    [DllImport("kernel32.dll", SetLastError = true, ExactSpelling = true)]
    private static extern void DeleteProcThreadAttributeList(IntPtr attributeList);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern uint WaitForSingleObject(IntPtr handle, uint milliseconds);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool GetExitCodeProcess(IntPtr process, out uint exitCode);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool CloseHandle(IntPtr handle);

    [STAThread]
    private static int Main(string[] arguments)
    {
        if (arguments.Length < 2 || !File.Exists(arguments[0])) return 1;

        string token = System.Diagnostics.Process.GetCurrentProcess().Id
            + "-"
            + Guid.NewGuid().ToString("N");
        string temporaryDirectory = Path.GetTempPath();
        string stdinPath = Path.Combine(temporaryDirectory, "letta-mem-hook-stdin-" + token + ".tmp");
        string stdoutPath = Path.Combine(temporaryDirectory, "letta-mem-hook-stdout-" + token + ".tmp");
        string stderrPath = Path.Combine(temporaryDirectory, "letta-mem-hook-stderr-" + token + ".tmp");

        try
        {
            File.WriteAllBytes(stdinPath, ReadAll(GetStdHandle(StdInputHandle)));
            File.WriteAllBytes(stdoutPath, new byte[0]);
            File.WriteAllBytes(stderrPath, new byte[0]);
            Environment.SetEnvironmentVariable("LETTA_MEM_HOOK_STDIN_FILE", stdinPath);
            Environment.SetEnvironmentVariable("LETTA_MEM_HOOK_STDOUT_FILE", stdoutPath);
            Environment.SetEnvironmentVariable("LETTA_MEM_HOOK_STDERR_FILE", stderrPath);

            string preloadPath = Path.Combine(
                AppDomain.CurrentDomain.BaseDirectory,
                "stdio-preload.cjs");
            if (!File.Exists(preloadPath)) return 1;

            var commandLine = new StringBuilder();
            AppendArgument(commandLine, arguments[0]);
            AppendArgument(commandLine, "--require");
            AppendArgument(commandLine, preloadPath);
            for (int index = 1; index < arguments.Length; index += 1)
            {
                AppendArgument(commandLine, arguments[index]);
            }

            return RunHeadless(
                arguments[0],
                commandLine,
                stdoutPath,
                stderrPath);
        }
        finally
        {
            DeleteFile(stdinPath);
            DeleteFile(stdoutPath);
            DeleteFile(stderrPath);
        }
    }

    private static int RunHeadless(
        string applicationName,
        StringBuilder commandLine,
        string stdoutPath,
        string stderrPath)
    {
        IntPtr pseudoInputRead = IntPtr.Zero;
        IntPtr pseudoInputWrite = IntPtr.Zero;
        IntPtr pseudoOutputRead = IntPtr.Zero;
        IntPtr pseudoOutputWrite = IntPtr.Zero;
        IntPtr pseudoConsole = IntPtr.Zero;
        IntPtr attributeList = IntPtr.Zero;
        IntPtr boxedPseudoConsole = IntPtr.Zero;
        ProcessInformation process = new ProcessInformation();
        Thread drainThread = null;

        try
        {
            var attributes = new SecurityAttributes();
            attributes.length = Marshal.SizeOf(typeof(SecurityAttributes));
            if (!CreatePipe(
                out pseudoInputRead,
                out pseudoInputWrite,
                ref attributes,
                0)) return 1;
            if (!CreatePipe(
                out pseudoOutputRead,
                out pseudoOutputWrite,
                ref attributes,
                0)) return 1;

            var consoleSize = new Coord { X = 120, Y = 30 };
            if (CreatePseudoConsole(
                consoleSize,
                pseudoInputRead,
                pseudoOutputWrite,
                0,
                out pseudoConsole) != 0) return 1;

            CloseHandle(pseudoInputRead);
            pseudoInputRead = IntPtr.Zero;
            CloseHandle(pseudoOutputWrite);
            pseudoOutputWrite = IntPtr.Zero;

            IntPtr attributeSize = IntPtr.Zero;
            InitializeProcThreadAttributeList(IntPtr.Zero, 1, 0, ref attributeSize);
            attributeList = Marshal.AllocHGlobal(attributeSize);
            if (!InitializeProcThreadAttributeList(
                attributeList,
                1,
                0,
                ref attributeSize)) return 1;

            boxedPseudoConsole = Marshal.AllocHGlobal(IntPtr.Size);
            Marshal.WriteIntPtr(boxedPseudoConsole, pseudoConsole);
            if (!UpdateProcThreadAttributeSafe(
                attributeList,
                ProcThreadAttributePseudoConsole,
                boxedPseudoConsole)) return 1;

            var startup = new StartupInfoEx();
            startup.startupInfo.cb = Marshal.SizeOf(typeof(StartupInfoEx));
            startup.attributeList = attributeList;

            bool created = CreateProcess(
                applicationName,
                commandLine,
                IntPtr.Zero,
                IntPtr.Zero,
                false,
                ExtendedStartupInfoPresent | CreateNoWindow,
                IntPtr.Zero,
                null,
                ref startup,
                out process);
            if (!created) return 1;

            CloseHandle(process.thread);
            process.thread = IntPtr.Zero;

            drainThread = new Thread(() => Drain(pseudoOutputRead));
            drainThread.IsBackground = true;
            drainThread.Start();

            WaitForSingleObject(process.process, Infinite);
            uint exitCode;
            if (!GetExitCodeProcess(process.process, out exitCode)) return 1;

            Relay(stdoutPath, GetStdHandle(StdOutputHandle));
            Relay(stderrPath, GetStdHandle(StdErrorHandle));
            return unchecked((int)exitCode);
        }
        finally
        {
            if (pseudoConsole != IntPtr.Zero) ClosePseudoConsole(pseudoConsole);
            if (drainThread != null) drainThread.Join(2000);
            CloseIfPresent(pseudoOutputRead);
            CloseIfPresent(pseudoOutputWrite);
            CloseIfPresent(pseudoInputRead);
            CloseIfPresent(pseudoInputWrite);
            CloseIfPresent(process.thread);
            CloseIfPresent(process.process);
            if (attributeList != IntPtr.Zero)
            {
                DeleteProcThreadAttributeList(attributeList);
                Marshal.FreeHGlobal(attributeList);
            }
            if (boxedPseudoConsole != IntPtr.Zero)
            {
                Marshal.FreeHGlobal(boxedPseudoConsole);
            }
        }
    }

    private static bool UpdateProcThreadAttributeSafe(
        IntPtr attributeList,
        IntPtr attribute,
        IntPtr value)
    {
        try
        {
            return UpdateProcThreadAttributeNew(
                attributeList,
                0,
                attribute,
                value,
                new IntPtr(IntPtr.Size),
                IntPtr.Zero,
                IntPtr.Zero);
        }
        catch (EntryPointNotFoundException)
        {
            return UpdateProcThreadAttributeOld(
                attributeList,
                0,
                attribute,
                value,
                new IntPtr(IntPtr.Size),
                IntPtr.Zero,
                IntPtr.Zero);
        }
    }

    private static byte[] ReadAll(IntPtr input)
    {
        using (var output = new MemoryStream())
        {
            var buffer = new byte[4096];
            uint bytesRead;
            while (ReadFile(
                input,
                buffer,
                (uint)buffer.Length,
                out bytesRead,
                IntPtr.Zero) && bytesRead > 0)
            {
                output.Write(buffer, 0, (int)bytesRead);
            }
            return output.ToArray();
        }
    }

    private static void Drain(IntPtr input)
    {
        var buffer = new byte[4096];
        uint bytesRead;
        while (ReadFile(
            input,
            buffer,
            (uint)buffer.Length,
            out bytesRead,
            IntPtr.Zero) && bytesRead > 0)
        {
            // ConPTY 输出必须持续读取，真实输出由预加载脚本捕获。
        }
    }

    private static void Relay(string path, IntPtr output)
    {
        try
        {
            byte[] data = File.ReadAllBytes(path);
            int offset = 0;
            while (offset < data.Length)
            {
                var chunk = new byte[data.Length - offset];
                Buffer.BlockCopy(data, offset, chunk, 0, chunk.Length);
                uint bytesWritten;
                if (!WriteFile(
                    output,
                    chunk,
                    (uint)chunk.Length,
                    out bytesWritten,
                    IntPtr.Zero) || bytesWritten == 0) return;
                offset += (int)bytesWritten;
            }
        }
        catch
        {
            // 父进程已退出或关闭句柄时无需继续转发。
        }
    }

    private static void AppendArgument(StringBuilder commandLine, string value)
    {
        if (commandLine.Length > 0) commandLine.Append(' ');
        commandLine.Append(QuoteArgument(value));
    }

    private static string QuoteArgument(string value)
    {
        if (value.Length > 0 && value.IndexOfAny(
            new[] { ' ', '\t', '\n', '\v', '"' }) < 0)
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

    private static void DeleteFile(string path)
    {
        try
        {
            if (File.Exists(path)) File.Delete(path);
        }
        catch
        {
            // 仅清理本次调用创建的精确临时文件。
        }
    }

    private static void CloseIfPresent(IntPtr handle)
    {
        if (handle != IntPtr.Zero) CloseHandle(handle);
    }
}
