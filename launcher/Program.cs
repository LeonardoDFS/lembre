using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Net.NetworkInformation;
using System.Net.Sockets;
using System.Threading;
using System.Windows.Forms;

internal static class Program
{
    [STAThread]
    private static void Main()
    {
        try
        {
            string root = AppDomain.CurrentDomain.BaseDirectory;
            string server = Path.Combine(root, "server", "dist", "index.js");
            if (!File.Exists(server)) throw new Exception("Arquivos do Lembre não encontrados. Mantenha Lembre.exe na pasta do projeto e execute npm run build.");
            string host = HomeAddress();
            string url = "http://" + host + ":4173/";
            if (!Ready(url))
            {
                string node = FindNode();
                if (node == null) throw new Exception("Node.js não encontrado. Instale o Node.js ou verifique o PATH.");
                ProcessStartInfo info = new ProcessStartInfo(node, "\"" + server + "\"");
                info.WorkingDirectory = root;
                info.UseShellExecute = false;
                info.CreateNoWindow = true;
                info.EnvironmentVariables["LEMBRE_LAN"] = "1";
                Process process = Process.Start(info);
                bool started = false;
                for (int i = 0; i < 60; i++)
                {
                    if (Ready(url)) { started = true; break; }
                    if (process.HasExited) break;
                    Thread.Sleep(250);
                }
                if (!started) throw new Exception("O servidor não iniciou. Verifique se a porta 4173 está livre e se o banco de dados está acessível.");
            }
            ProcessStartInfo browser = new ProcessStartInfo(url);
            browser.UseShellExecute = true;
            Process.Start(browser);
        }
        catch (Exception error)
        {
            MessageBox.Show(error.Message, "Lembre", MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
    }

    private static bool Ready(string url)
    {
        try
        {
            HttpWebRequest request = (HttpWebRequest)WebRequest.Create(url + "api/setup/status");
            request.Timeout = 600;
            request.ReadWriteTimeout = 600;
            using (HttpWebResponse response = (HttpWebResponse)request.GetResponse())
            using (StreamReader reader = new StreamReader(response.GetResponseStream()))
                return response.StatusCode == HttpStatusCode.OK && reader.ReadToEnd().Contains("needsSetup");
        }
        catch { return false; }
    }

    private static string FindNode()
    {
        string[] path = (Environment.GetEnvironmentVariable("PATH") ?? "").Split(Path.PathSeparator);
        foreach (string directory in path)
        {
            try
            {
                string candidate = Path.Combine(directory.Trim('"'), "node.exe");
                if (File.Exists(candidate)) return candidate;
            }
            catch { }
        }
        string installed = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "nodejs", "node.exe");
        return File.Exists(installed) ? installed : null;
    }

    private static string HomeAddress()
    {
        List<string> addresses = new List<string>();
        foreach (NetworkInterface adapter in NetworkInterface.GetAllNetworkInterfaces())
        {
            if (adapter.OperationalStatus != OperationalStatus.Up) continue;
            string name = adapter.Name.ToLowerInvariant();
            if (name.Contains("vpn") || name.Contains("virtual") || name.Contains("vethernet") ||
                name.Contains("loopback") || name.Contains("tunnel")) continue;
            foreach (UnicastIPAddressInformation entry in adapter.GetIPProperties().UnicastAddresses)
                if (entry.Address.AddressFamily == AddressFamily.InterNetwork)
                    addresses.Add(entry.Address.ToString());
        }
        foreach (string prefix in new[] { "192.168.", "10.", "172." })
            foreach (string address in addresses)
                if (address.StartsWith(prefix)) return address;
        throw new Exception("Rede de casa não encontrada. Conecte o PC ao Wi-Fi ou Ethernet e tente novamente.");
    }
}
