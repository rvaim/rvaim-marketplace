using System;
using System.Collections;
using System.Collections.Generic;
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
    private const uint CreateUnicodeEnvironment = 0x00000400;
    private const uint CreateSuspended = 0x00000004;
    private const uint CreateBreakawayFromJob = 0x01000000;
    private const uint CreateNewProcessGroup = 0x00000200;
    private const uint JobObjectLimitSilentBreakawayOk = 0x00001000;
    private const uint JobObjectLimitKillOnJobClose = 0x00002000;
    private const uint Infinite = 0xFFFFFFFF;
    private const int JobObjectExtendedLimitInformation = 9;
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

    [StructLayout(LayoutKind.Sequential)]
    private struct IoCounters
    {
        public ulong readOperationCount;
        public ulong writeOperationCount;
        public ulong otherOperationCount;
        public ulong readTransferCount;
        public ulong writeTransferCount;
        public ulong otherTransferCount;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct BasicLimitInformation
    {
        public long perProcessUserTimeLimit;
        public long perJobUserTimeLimit;
        public uint limitFlags;
        public UIntPtr minimumWorkingSetSize;
        public UIntPtr maximumWorkingSetSize;
        public uint activeProcessLimit;
        public UIntPtr affinity;
        public uint priorityClass;
        public uint schedulingClass;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct ExtendedLimitInformation
    {
        public BasicLimitInformation basicLimitInformation;
        public IoCounters ioInfo;
        public UIntPtr processMemoryLimit;
        public UIntPtr jobMemoryLimit;
        public UIntPtr peakProcessMemoryUsed;
        public UIntPtr peakJobMemoryUsed;
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

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern IntPtr CreateJobObject(
        IntPtr jobAttributes,
        string name);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool SetInformationJobObject(
        IntPtr job,
        int informationClass,
        IntPtr information,
        uint informationLength);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool AssignProcessToJobObject(
        IntPtr job,
        IntPtr process);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern uint ResumeThread(IntPtr thread);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool TerminateProcess(IntPtr process, uint exitCode);

    [STAThread]
    private static int Main(string[] arguments)
    {
        bool background = arguments.Length >= 2
            && arguments[0] == "--background";
        int firstArgument = background ? 1 : 0;
        string nodePath;
        var nodeArguments = new List<string>();
        if (
            arguments.Length - firstArgument >= 2
            && File.Exists(arguments[firstArgument])
            && File.Exists(arguments[firstArgument + 1])
        )
        {
            nodePath = Path.GetFullPath(arguments[firstArgument]);
            for (int index = firstArgument + 1; index < arguments.Length; index += 1)
            {
                nodeArguments.Add(arguments[index]);
            }
        }
        else if (arguments.Length - firstArgument >= 1)
        {
            nodePath = ResolveNodeExecutable();
            if (nodePath == null)
            {
                WriteDiagnostic("Letta memory Hook launcher could not find node.exe on PATH.\n");
                return 1;
            }
            string bootstrapPath = Path.Combine(
                AppDomain.CurrentDomain.BaseDirectory,
                "bootstrap.cjs");
            if (!File.Exists(bootstrapPath))
            {
                WriteDiagnostic("Letta memory Hook bootstrap.cjs is missing.\n");
                return 1;
            }
            nodeArguments.Add(bootstrapPath);
            for (int index = firstArgument; index < arguments.Length; index += 1)
            {
                nodeArguments.Add(arguments[index]);
            }
        }
        else
        {
            WriteDiagnostic("Letta memory Hook launcher requires an action.\n");
            return 1;
        }

        string token = System.Diagnostics.Process.GetCurrentProcess().Id
            + "-"
            + Guid.NewGuid().ToString("N");
        string temporaryDirectory = Path.GetTempPath();
        CleanupStaleTemporaryFiles(temporaryDirectory);
        string stdinPath = Path.Combine(temporaryDirectory, "letta-mem-hook-stdin-" + token + ".tmp");
        string stdoutPath = Path.Combine(temporaryDirectory, "letta-mem-hook-stdout-" + token + ".tmp");
        string stderrPath = Path.Combine(temporaryDirectory, "letta-mem-hook-stderr-" + token + ".tmp");
        bool deleteInput = true;

        try
        {
            File.WriteAllBytes(stdinPath, ReadAll(GetStdHandle(StdInputHandle)));
            if (!background)
            {
                File.WriteAllBytes(stdoutPath, new byte[0]);
                File.WriteAllBytes(stderrPath, new byte[0]);
            }

            string preloadPath = Path.Combine(
                AppDomain.CurrentDomain.BaseDirectory,
                "stdio-preload.cjs");
            if (!File.Exists(preloadPath))
            {
                WriteDiagnostic("Letta memory Hook stdio-preload.cjs is missing.\n");
                return 1;
            }

            var commandLine = new StringBuilder();
            AppendArgument(commandLine, nodePath);
            AppendArgument(commandLine, "--require");
            AppendArgument(commandLine, preloadPath);
            foreach (string argument in nodeArguments)
            {
                AppendArgument(commandLine, argument);
            }

            var environmentOverrides = new Dictionary<string, string>
            {
                { "LETTA_MEM_HOOK_STDIN_FILE", stdinPath },
                { "LETTA_MEM_NODE_PATH", nodePath },
            };
            if (background)
            {
                environmentOverrides["LETTA_MEM_DELETE_HOOK_STDIN_FILE"] = "1";
            }
            else
            {
                environmentOverrides["LETTA_MEM_HOOK_STDOUT_FILE"] = stdoutPath;
                environmentOverrides["LETTA_MEM_HOOK_STDERR_FILE"] = stderrPath;
            }
            IntPtr environment = BuildEnvironmentBlock(environmentOverrides);
            try
            {
                if (background)
                {
                    if (!RunDetached(nodePath, commandLine, environment)) return 1;
                    deleteInput = false;
                    return 0;
                }
                return RunHeadless(
                    nodePath,
                    commandLine,
                    environment,
                    stdoutPath,
                    stderrPath);
            }
            finally
            {
                Marshal.FreeHGlobal(environment);
            }
        }
        catch (Exception error)
        {
            WriteDiagnostic("Letta memory Hook launcher failed: " + error.Message + "\n");
            return 1;
        }
        finally
        {
            if (deleteInput) DeleteFile(stdinPath);
            DeleteFile(stdoutPath);
            DeleteFile(stderrPath);
        }
    }

    private static bool RunDetached(
        string applicationName,
        StringBuilder commandLine,
        IntPtr environment)
    {
        var startup = new StartupInfoEx();
        startup.startupInfo.cb = Marshal.SizeOf(typeof(StartupInfo));
        ProcessInformation process;
        uint flags = CreateNoWindow
            | CreateUnicodeEnvironment
            | CreateNewProcessGroup
            | CreateBreakawayFromJob;
        bool created = CreateProcess(
            applicationName,
            new StringBuilder(commandLine.ToString()),
            IntPtr.Zero,
            IntPtr.Zero,
            false,
            flags,
            environment,
            null,
            ref startup,
            out process);
        if (!created && Marshal.GetLastWin32Error() == 5)
        {
            created = CreateProcess(
                applicationName,
                new StringBuilder(commandLine.ToString()),
                IntPtr.Zero,
                IntPtr.Zero,
                false,
                flags & ~CreateBreakawayFromJob,
                environment,
                null,
                ref startup,
                out process);
        }
        if (!created) return false;
        CloseHandle(process.thread);
        CloseHandle(process.process);
        return true;
    }

    private static int RunHeadless(
        string applicationName,
        StringBuilder commandLine,
        IntPtr environment,
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
        IntPtr terminationJob = IntPtr.Zero;
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

            terminationJob = CreateTerminationJob();
            if (terminationJob == IntPtr.Zero) return 1;

            bool created = CreateProcess(
                applicationName,
                commandLine,
                IntPtr.Zero,
                IntPtr.Zero,
                false,
                ExtendedStartupInfoPresent
                    | CreateNoWindow
                    | CreateUnicodeEnvironment
                    | CreateSuspended,
                environment,
                null,
                ref startup,
                out process);
            if (!created) return 1;

            if (!AssignProcessToJobObject(terminationJob, process.process))
            {
                TerminateProcess(process.process, 1);
                return 1;
            }
            if (ResumeThread(process.thread) == UInt32.MaxValue)
            {
                TerminateProcess(process.process, 1);
                return 1;
            }

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
            CloseIfPresent(terminationJob);
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

    private static IntPtr CreateTerminationJob()
    {
        IntPtr job = CreateJobObject(IntPtr.Zero, null);
        if (job == IntPtr.Zero) return IntPtr.Zero;

        var information = new ExtendedLimitInformation();
        information.basicLimitInformation.limitFlags =
            JobObjectLimitKillOnJobClose
            | JobObjectLimitSilentBreakawayOk;
        int size = Marshal.SizeOf(typeof(ExtendedLimitInformation));
        IntPtr pointer = Marshal.AllocHGlobal(size);
        try
        {
            Marshal.StructureToPtr(information, pointer, false);
            if (!SetInformationJobObject(
                job,
                JobObjectExtendedLimitInformation,
                pointer,
                (uint)size))
            {
                CloseHandle(job);
                return IntPtr.Zero;
            }
            return job;
        }
        finally
        {
            Marshal.FreeHGlobal(pointer);
        }
    }

    private static IntPtr BuildEnvironmentBlock(
        IDictionary<string, string> overrides)
    {
        var values = new SortedDictionary<string, string>(
            StringComparer.OrdinalIgnoreCase);
        foreach (DictionaryEntry entry in Environment.GetEnvironmentVariables())
        {
            string key = entry.Key as string;
            if (String.IsNullOrEmpty(key)) continue;
            values[key] = Convert.ToString(entry.Value) ?? "";
        }
        foreach (KeyValuePair<string, string> entry in overrides)
        {
            values[entry.Key] = entry.Value;
        }

        var block = new StringBuilder();
        foreach (KeyValuePair<string, string> entry in values)
        {
            block.Append(entry.Key);
            block.Append('=');
            block.Append(entry.Value);
            block.Append('\0');
        }
        block.Append('\0');
        return Marshal.StringToHGlobalUni(block.ToString());
    }

    private static string ResolveNodeExecutable()
    {
        foreach (string variable in new[] { "LETTA_MEM_NODE_PATH", "NODE" })
        {
            string configured = Environment.GetEnvironmentVariable(variable);
            if (
                !String.IsNullOrWhiteSpace(configured)
                && Path.IsPathRooted(configured)
                && File.Exists(configured)
            )
            {
                return Path.GetFullPath(configured);
            }
        }

        string pathValue = Environment.GetEnvironmentVariable("PATH") ?? "";
        foreach (string rawDirectory in pathValue.Split(Path.PathSeparator))
        {
            string directory = rawDirectory.Trim().Trim('"');
            if (directory.Length == 0) continue;
            string candidate;
            try
            {
                candidate = Path.GetFullPath(Path.Combine(directory, "node.exe"));
            }
            catch
            {
                continue;
            }
            if (File.Exists(candidate)) return candidate;
        }
        return null;
    }

    private static void CleanupStaleTemporaryFiles(string directory)
    {
        DateTime cutoff = DateTime.UtcNow.AddDays(-1);
        foreach (string prefix in new[]
        {
            "letta-mem-hook-stdin-",
            "letta-mem-hook-stdout-",
            "letta-mem-hook-stderr-",
        })
        {
            try
            {
                foreach (string path in Directory.GetFiles(directory, prefix + "*.tmp"))
                {
                    try
                    {
                        if (File.GetLastWriteTimeUtc(path) < cutoff) File.Delete(path);
                    }
                    catch
                    {
                        // 其他 Hook 仍在使用或文件已被并发清理时忽略。
                    }
                }
            }
            catch
            {
                // 临时目录枚举失败不能阻止当前 Hook。
            }
        }
    }

    private static void WriteDiagnostic(string message)
    {
        try
        {
            WriteAll(GetStdHandle(StdErrorHandle), Encoding.UTF8.GetBytes(message));
        }
        catch
        {
            // 父进程已关闭 stderr 时无处返回诊断信息。
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
            WriteAll(output, data);
        }
        catch
        {
            // 父进程已退出或关闭句柄时无需继续转发。
        }
    }

    private static void WriteAll(IntPtr output, byte[] data)
    {
        int offset = 0;
        while (offset < data.Length)
        {
            int count = Math.Min(64 * 1024, data.Length - offset);
            var chunk = new byte[count];
            Buffer.BlockCopy(data, offset, chunk, 0, count);
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
        for (int attempt = 0; attempt < 10; attempt += 1)
        {
            try
            {
                if (!File.Exists(path)) return;
                File.Delete(path);
                return;
            }
            catch
            {
                // 进程退出后杀毒软件或流关闭可能短暂持有文件。
                if (attempt < 9) Thread.Sleep(20);
            }
        }
    }

    private static void CloseIfPresent(IntPtr handle)
    {
        if (handle != IntPtr.Zero) CloseHandle(handle);
    }
}
