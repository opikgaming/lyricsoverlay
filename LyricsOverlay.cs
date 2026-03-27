using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Text;
using System.Windows.Forms;
using System.IO;
using System.Net;
using System.Text;
using System.Text.RegularExpressions;

namespace LyricsOverlay
{
    static class Program
    {
        [STAThread]
        public static void Main()
        {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.Run(new ConfigForm());
        }
    }

    public class SubtitleLabel : Control
    {
        private string _displayText  = "";
        private string _upcomingText = "";
        private Color  _mainColor    = Color.Yellow;
        private Color  _strokeColor  = Color.Black;
        private Color  _upcColor     = Color.LightGray;
        private Color  _chromaKey    = Color.Magenta;
        private bool   _showStroke   = false;
        private bool   _showUpcStroke = false;
        private bool   _showUpcoming = false;
        private int    _strokeWidth  = 3;
        private int    _upcPos       = 0;   
        private int    _upcGap       = 0;
        private StringAlignment _alignH = StringAlignment.Center;
        private StringAlignment _alignV = StringAlignment.Far;

        public string DisplayText
        {
            get { return _displayText; }
            set { if (_displayText != value) { _displayText = value; Invalidate(); } }
        }
        public string UpcomingText
        {
            get { return _upcomingText; }
            set { if (_upcomingText != value) { _upcomingText = value; Invalidate(); } }
        }
        public Color MainColor
        {
            get { return _mainColor; }
            set { if (_mainColor != value) { _mainColor = value; Invalidate(); } }
        }
        public Color StrokeColor
        {
            get { return _strokeColor; }
            set { if (_strokeColor != value) { _strokeColor = value; Invalidate(); } }
        }
        public Color UpcColor
        {
            get { return _upcColor; }
            set { if (_upcColor != value) { _upcColor = value; Invalidate(); } }
        }
        public Color ChromaKey
        {
            get { return _chromaKey; }
            set { if (_chromaKey != value) { _chromaKey = value; Invalidate(); } }
        }
        public bool ShowStroke
        {
            get { return _showStroke; }
            set { if (_showStroke != value) { _showStroke = value; Invalidate(); } }
        }
        public bool ShowUpcStroke
        {
            get { return _showUpcStroke; }
            set { if (_showUpcStroke != value) { _showUpcStroke = value; Invalidate(); } }
        }
        public bool ShowUpcoming
        {
            get { return _showUpcoming; }
            set { if (_showUpcoming != value) { _showUpcoming = value; Invalidate(); } }
        }
        public int StrokeWidth
        {
            get { return _strokeWidth; }
            set { if (_strokeWidth != value) { _strokeWidth = value; Invalidate(); } }
        }
        public int UpcPos
        {
            get { return _upcPos; }
            set { if (_upcPos != value) { _upcPos = value; Invalidate(); } }
        }
        public int UpcGap
        {
            get { return _upcGap; }
            set { if (_upcGap != value) { _upcGap = value; Invalidate(); } }
        }
        public StringAlignment TextAlignment
        {
            get { return _alignH; }
            set { if (_alignH != value) { _alignH = value; Invalidate(); } }
        }
        public StringAlignment LineAlignment
        {
            get { return _alignV; }
            set { if (_alignV != value) { _alignV = value; Invalidate(); } }
        }

        public SubtitleLabel()
        {
            SetStyle(ControlStyles.UserPaint | ControlStyles.AllPaintingInWmPaint |
                     ControlStyles.OptimizedDoubleBuffer | ControlStyles.ResizeRedraw |
                     ControlStyles.SupportsTransparentBackColor, true);
            BackColor = Color.Transparent;
            Font = new Font("Segoe UI", 36, FontStyle.Bold);
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            e.Graphics.Clear(_chromaKey);

            bool hasMain = !string.IsNullOrEmpty(_displayText);
            bool hasUpc  = _showUpcoming && !string.IsNullOrEmpty(_upcomingText);
            if (!hasMain && !hasUpc) return;

            Graphics g = e.Graphics;

            g.SmoothingMode     = SmoothingMode.None;
            g.InterpolationMode = InterpolationMode.NearestNeighbor;
            g.TextRenderingHint = TextRenderingHint.SingleBitPerPixel;

            float emSize = Font.SizeInPoints * (g.DpiY / 72f);
            float upcEm  = emSize * 0.6f;

            using (StringFormat sf = new StringFormat())
            {
                sf.Alignment     = _alignH;
                sf.LineAlignment = _alignV;

                RectangleF mainRect = new RectangleF(0, 0, Width, Height);
                RectangleF upcRect  = new RectangleF(0, 0, Width, Height);

                if (hasUpc)
                {
                    int mainLines = hasMain ? _displayText.Split('\n').Length : 1;
                    int upcLines  = _upcomingText.Split('\n').Length;
                    float mainH   = Font.Height * mainLines;
                    float upcH    = Font.Height * 0.6f * upcLines;
                    float gap     = _upcGap;

                    if (_upcPos == 0)
                    {
                        if      (_alignV == StringAlignment.Near) { mainRect.Y += upcH + gap; }
                        else if (_alignV == StringAlignment.Far)  { upcRect.Y  -= mainH + gap; }
                        else { mainRect.Y += (upcH + gap) / 2f; upcRect.Y -= (mainH + gap) / 2f; }
                    }
                    else
                    {
                        if      (_alignV == StringAlignment.Near) { upcRect.Y  += mainH + gap; }
                        else if (_alignV == StringAlignment.Far)  { mainRect.Y -= upcH + gap; }
                        else { mainRect.Y -= (upcH + gap) / 2f; upcRect.Y += (mainH + gap) / 2f; }
                    }
                }

                if (hasMain)
                    DrawText(g, _displayText, mainRect, sf, emSize,
                             _mainColor, _strokeColor, _strokeWidth, _showStroke);

                if (hasUpc)
                    DrawText(g, _upcomingText, upcRect, sf, upcEm,
                             _upcColor, _strokeColor, Math.Max(1, _strokeWidth - 1), _showUpcStroke);
            }
        }

        private void DrawText(Graphics g, string text, RectangleF rect, StringFormat sf,
                               float emSize, Color fill, Color stroke, int strokeWidth, bool doStroke)
        {
            FontFamily ff = Font.FontFamily;

            using (GraphicsPath path = new GraphicsPath())
            {
                path.AddString(text, ff, (int)Font.Style, emSize, rect, sf);

                if (doStroke && strokeWidth > 0)
                {
                    using (Pen pen = new Pen(stroke, strokeWidth) { LineJoin = LineJoin.Round })
                        g.DrawPath(pen, path);
                }

                using (SolidBrush brush = new SolidBrush(fill))
                    g.FillPath(brush, path);
            }
        }
    }

    public class OverlayForm : Form
    {
        public SubtitleLabel subLabel;
        private bool   _draggable;
        private string _savedDisplay  = "";
        private string _savedUpcoming = "";

        public static Point DefaultLocation()
        {
            return new Point(0, Screen.PrimaryScreen.Bounds.Height - 250);
        }
        public static new Size DefaultSize()
        {
            return new Size(Screen.PrimaryScreen.Bounds.Width, 200);
        }

        public OverlayForm()
        {
            FormBorderStyle = FormBorderStyle.None;
            TopMost         = true;
            StartPosition   = FormStartPosition.Manual;
            ShowInTaskbar   = false;
            Size            = DefaultSize();
            Location        = DefaultLocation();
            BackColor       = Color.Magenta;
            TransparencyKey = Color.Magenta;

            subLabel      = new SubtitleLabel();
            subLabel.Dock = DockStyle.Fill;

            subLabel.MouseDown += delegate(object s, MouseEventArgs e)
            {
                if (_draggable && e.Button == MouseButtons.Left)
                {
                    NativeMethods.ReleaseCapture();
                    NativeMethods.SendMessage(Handle, 0xA1, 0x2, 0); 
                }
            };

            Controls.Add(subLabel);
            SetDraggable(false);
        }

        public void ResetPosition() { Size = DefaultSize(); Location = DefaultLocation(); }
        public void ForceRedraw()   { subLabel.Invalidate(); }

        public void SetDraggable(bool drag)
        {
            _draggable          = drag;
            subLabel.ChromaKey  = drag ? Color.DimGray : Color.Magenta;
            BackColor           = drag ? Color.DimGray : Color.Magenta;
            TransparencyKey     = drag ? Color.Empty   : Color.Magenta;
            Opacity             = drag ? 0.65          : 1.0;

            if (drag)
            {
                _savedDisplay         = subLabel.DisplayText;
                _savedUpcoming        = subLabel.UpcomingText;
                subLabel.DisplayText  = "\u283F DRAG ME \u283F";
                subLabel.UpcomingText = "";
            }
            else
            {
                subLabel.DisplayText  = _savedDisplay;
                subLabel.UpcomingText = _savedUpcoming;
            }

            RecreateHandle();
        }

        protected override CreateParams CreateParams
        {
            get
            {
                CreateParams cp = base.CreateParams;
                cp.ExStyle |= 0x80000; 
                if (!_draggable)
                    cp.ExStyle |= 0x20; 
                return cp;
            }
        }
    }

    public class LyricsHttpServer
    {
        private HttpListener _listener;

        public int      Port         { get; private set; }
        public bool     IsRunning    { get; private set; }
        public string   LastMain     { get; private set; }
        public DateTime LastReceived { get; private set; }

        private readonly Action<string, string> _onUpdate;
        private readonly Action                 _onClear;

        public LyricsHttpServer(int port, Action<string, string> onUpdate, Action onClear)
        {
            Port      = port;
            _onUpdate = onUpdate;
            _onClear  = onClear;
        }

        public bool Start()
        {
            try
            {
                _listener = new HttpListener();
                _listener.Prefixes.Add("http://localhost:" + Port + "/");
                _listener.Start();
                IsRunning = true;
                _listener.BeginGetContext(OnContext, null);
                return true;
            }
            catch { return false; }
        }

        public void Stop()
        {
            IsRunning = false;
            try { if (_listener != null) { _listener.Stop(); _listener.Close(); } } catch { }
        }

        private void OnContext(IAsyncResult ar)
        {
            if (!_listener.IsListening) return;

            HttpListenerContext ctx;
            try   { ctx = _listener.EndGetContext(ar); }
            catch { return; }

            try { _listener.BeginGetContext(OnContext, null); } catch { return; }

            try
            {
                ctx.Response.Headers.Add("Access-Control-Allow-Origin",  "*");
                ctx.Response.Headers.Add("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
                ctx.Response.Headers.Add("Access-Control-Allow-Headers", "Content-Type");

                if (ctx.Request.HttpMethod == "OPTIONS")
                {
                    ctx.Response.StatusCode = 200;
                    ctx.Response.Close();
                    return;
                }

                string reqPath = ctx.Request.Url.AbsolutePath.ToLower().TrimEnd('/');

                if (reqPath == "/subtitle" && ctx.Request.HttpMethod == "POST")
                {
                    string body     = new StreamReader(ctx.Request.InputStream, Encoding.UTF8).ReadToEnd();
                    string main     = JsonStr(body, "main");
                    string upcoming = JsonStr(body, "upcoming");

                    LastMain     = main;
                    LastReceived = DateTime.Now;

                    if (_onUpdate != null) _onUpdate(main, upcoming);
                    Respond(ctx, "OK");
                }
                else if (reqPath == "/clear")
                {
                    LastMain     = "";
                    LastReceived = DateTime.Now;
                    if (_onClear != null) _onClear();
                    Respond(ctx, "OK");
                }
                else if (reqPath == "/ping")
                {
                    Respond(ctx, "pong");
                }
                else
                {
                    ctx.Response.StatusCode = 404;
                    ctx.Response.Close();
                }
            }
            catch
            {
                try { ctx.Response.StatusCode = 500; ctx.Response.Close(); } catch { }
            }
        }

        private static void Respond(HttpListenerContext ctx, string text)
        {
            byte[] buf = Encoding.UTF8.GetBytes(text);
            ctx.Response.StatusCode      = 200;
            ctx.Response.ContentType     = "text/plain; charset=utf-8";
            ctx.Response.ContentLength64 = buf.Length;
            ctx.Response.OutputStream.Write(buf, 0, buf.Length);
            ctx.Response.Close();
        }

        private static string JsonStr(string json, string key)
        {
            Match m = Regex.Match(json,
                "\"" + Regex.Escape(key) + "\"\\s*:\\s*\"((?:[^\"\\\\]|\\\\.)*)\"");
            if (!m.Success) return "";
            return m.Groups[1].Value
                .Replace("\\n",  "\n")
                .Replace("\\r",  "")
                .Replace("\\\"", "\"")
                .Replace("\\\\", "\\")
                .Replace("\\t",  "\t");
        }
    }

    public class ConfigForm : Form
    {
        private OverlayForm               _overlay;
        private LyricsHttpServer          _server;
        private System.Windows.Forms.Timer _statusTimer;
        private bool                      _dragMode = false;

        private Label  _lblStatus, _lblLast;
        private Button _btnToggle;

        private Button        _btnMainColor, _btnStrColor, _btnUpcColor;
        private CheckBox      _chkStroke, _chkUpc, _chkUpcStroke;
        private NumericUpDown _numSize, _numStrWidth, _numUpcGap;
        private ComboBox      _cmbHAlign, _cmbVAlign, _cmbUpcPos;
        private Button        _btnDrag, _btnReset;

        private NumericUpDown _numPort;
        private Label         _lblEndpoints;

        private int  _savedX, _savedY;
        private bool _hasSavedPos;

        public ConfigForm()
        {
            Text            = "LyricsOverlay App";
            Size            = new Size(420, 480);
            FormBorderStyle = FormBorderStyle.FixedSingle;
            MinimizeBox     = true;
            MaximizeBox     = false;
            StartPosition   = FormStartPosition.CenterScreen;
            FormClosing    += OnClosing;

            _lblStatus = new Label()
            {
                Location  = new Point(10, 10), Size = new Size(385, 20),
                Font      = new Font("Segoe UI", 9, FontStyle.Bold),
                ForeColor = Color.Gray
            };
            _lblLast = new Label()
            {
                Location  = new Point(10, 32), Size = new Size(385, 16),
                Font      = new Font("Segoe UI", 7.5f),
                ForeColor = Color.Gray
            };
            _btnToggle = new Button()
            {
                Text     = "\u266B Hide Overlay",
                Location = new Point(10, 52), Size = new Size(385, 28)
            };
            _btnToggle.Click += delegate { _overlay.Visible = !_overlay.Visible; UpdateToggleText(); };

            Controls.Add(_lblStatus);
            Controls.Add(_lblLast);
            Controls.Add(_btnToggle);

            TabControl tab = new TabControl() { Location = new Point(5, 88), Size = new Size(398, 350) };
            Controls.Add(tab);

            TabPage pgServer  = new TabPage("\u26A1 Server & Info");
            TabPage pgDisplay = new TabPage("\u2699 Display");
            tab.TabPages.Add(pgServer);
            tab.TabPages.Add(pgDisplay);

            BuildServerTab(pgServer);
            BuildDisplayTab(pgDisplay);

            _overlay = new OverlayForm();
            _overlay.Show();

            LoadConfig();

            _server = new LyricsHttpServer((int)_numPort.Value, OnLyricsReceived, OnClearReceived);
            if (!_server.Start())
                MessageBox.Show(
                    "Could not start HTTP server on port " + _numPort.Value + ".\nTry changing the port.",
                    "Server Error", MessageBoxButtons.OK, MessageBoxIcon.Warning);

            UpdateEndpointLabel();
            UpdateLabelVisuals();

            _statusTimer = new System.Windows.Forms.Timer() { Interval = 800 };
            _statusTimer.Tick += delegate { UpdateStatus(); };
            _statusTimer.Start();
            UpdateStatus();
        }

        private void BuildServerTab(TabPage p)
        {
            Label h1    = Hdr("HTTP Listener", 10, 12);
            Label lPort = new Label() { Text = "Port:", Location = new Point(10, 40), AutoSize = true };
            _numPort    = new NumericUpDown()
            {
                Location = new Point(55, 37), Width = 80,
                Minimum = 1024, Maximum = 65535, Value = 7331
            };
            Button btnRestart = new Button()
            {
                Text = "Restart Server", Location = new Point(150, 36),
                Size = new Size(105, 24), BackColor = Color.LightCyan
            };
            btnRestart.Click += delegate
            {
                _server.Stop();
                _server = new LyricsHttpServer((int)_numPort.Value, OnLyricsReceived, OnClearReceived);
                _server.Start();
                UpdateEndpointLabel();
                UpdateStatus();
            };

            Label h2      = Hdr("Endpoints", 10, 74);
            _lblEndpoints = new Label()
            {
                Location  = new Point(10, 92), Size = new Size(365, 100),
                Font      = new Font("Courier New", 7.5f),
                ForeColor = Color.DimGray
            };

            Label h3    = Hdr("Supported Platforms", 10, 200);
            Label lPlat = new Label()
            {
                Text      = "\u2705 YouTube\r\n\u2705 YouTube Music\r\n\u26A0 Spotify Web\r\n\u274C Deezer / Tidal\r\n\u274C SoundCloud",
                Location  = new Point(10, 218), Size = new Size(370, 100),
                ForeColor = Color.DimGray, Font = new Font("Segoe UI", 8f)
            };

            p.Controls.AddRange(new Control[] { h1, lPort, _numPort, btnRestart, h2, _lblEndpoints, h3, lPlat });
        }

        private void BuildDisplayTab(TabPage p)
        {
            Label h1      = Hdr("Main Text", 10, 12);
            _btnMainColor = Btn("Text Color", 10, 35, Color.Yellow);
            Label lSz     = new Label() { Text = "Size:", Location = new Point(115, 40), AutoSize = true };
            _numSize      = new NumericUpDown()
            {
                Location = new Point(160, 37), Width = 65,
                Minimum = 10, Maximum = 120, Value = 36
            };

            Label h2      = Hdr("Outline / Stroke", 10, 78);
            _chkStroke    = new CheckBox() { Text = "Enable", Location = new Point(10, 98), Width = 65 };
            _btnStrColor  = Btn("Color", 80, 95, Color.Black);
            Label lW      = new Label() { Text = "Width:", Location = new Point(162, 99), AutoSize = true };
            _numStrWidth  = new NumericUpDown()
            {
                Location = new Point(210, 96), Width = 55,
                Minimum = 1, Maximum = 15, Value = 3
            };

            Label h3     = Hdr("Upcoming Lyric Line", 10, 135);
            _chkUpc      = new CheckBox() { Text = "Enable", Location = new Point(10, 155), Width = 65 };
            _btnUpcColor = Btn("Color", 80, 152, Color.LightGray);
            _cmbUpcPos   = new ComboBox()
            {
                Location = new Point(162, 153), Width = 110,
                DropDownStyle = ComboBoxStyle.DropDownList
            };
            _cmbUpcPos.Items.AddRange(new object[] { "Above", "Below" });
            _cmbUpcPos.SelectedIndex = 0;
            Label lGap = new Label() { Text = "Gap:", Location = new Point(280, 156), AutoSize = true };
            _numUpcGap = new NumericUpDown()
            {
                Location = new Point(315, 153), Width = 55,
                Minimum = -50, Maximum = 100, Value = 0
            };
            
            _chkUpcStroke = new CheckBox() { Text = "Stroke", Location = new Point(10, 175), Width = 65 };

            Label h4   = Hdr("Alignment", 10, 212);
            _cmbHAlign = new ComboBox()
            {
                Location = new Point(10, 230), Width = 90,
                DropDownStyle = ComboBoxStyle.DropDownList
            };
            _cmbHAlign.Items.AddRange(new object[] { "Left", "Center", "Right" });
            _cmbHAlign.SelectedIndex = 1;

            _cmbVAlign = new ComboBox()
            {
                Location = new Point(110, 230), Width = 90,
                DropDownStyle = ComboBoxStyle.DropDownList
            };
            _cmbVAlign.Items.AddRange(new object[] { "Top", "Center", "Bottom" });
            _cmbVAlign.SelectedIndex = 2;

            Label h5  = Hdr("Overlay Window", 10, 268);
            _btnDrag  = new Button()
            {
                Text = "\u283F Drag Mode", Location = new Point(10, 286),
                Size = new Size(120, 28), BackColor = Color.LightCoral
            };
            _btnReset = new Button()
            {
                Text = "\u21BA Reset Pos", Location = new Point(138, 286),
                Size = new Size(120, 28), BackColor = Color.LightSteelBlue
            };

            _btnMainColor.Click += PickColor;
            _btnStrColor.Click  += PickColor;
            _btnUpcColor.Click  += PickColor;

            EventHandler upd = delegate { UpdateLabelVisuals(); };
            _numSize.ValueChanged           += upd;
            _numStrWidth.ValueChanged       += upd;
            _chkStroke.CheckedChanged       += upd;
            _chkUpc.CheckedChanged          += upd;
            _chkUpcStroke.CheckedChanged    += upd;
            _numUpcGap.ValueChanged         += upd;
            _cmbUpcPos.SelectedIndexChanged += upd;
            _cmbHAlign.SelectedIndexChanged += upd;
            _cmbVAlign.SelectedIndexChanged += upd;

            _btnDrag.Click += OnDragToggle;
            _btnReset.Click += delegate
            {
                _overlay.ResetPosition();
                if (_dragMode) OnDragToggle(null, null); 
            };

            p.Controls.AddRange(new Control[] {
                h1, _btnMainColor, lSz, _numSize,
                h2, _chkStroke, _btnStrColor, lW, _numStrWidth,
                h3, _chkUpc, _btnUpcColor, _cmbUpcPos, lGap, _numUpcGap, _chkUpcStroke,
                h4, _cmbHAlign, _cmbVAlign,
                h5, _btnDrag, _btnReset
            });
        }

        private static Label Hdr(string text, int x, int y)
        {
            return new Label()
            {
                Text      = text, Location = new Point(x, y), AutoSize = true,
                Font      = new Font("Segoe UI", 8, FontStyle.Bold),
                ForeColor = Color.DimGray
            };
        }

        private static Button Btn(string text, int x, int y, Color back)
        {
            return new Button() { Text = text, Location = new Point(x, y), Width = 80, BackColor = back };
        }

        private void OnLyricsReceived(string main, string upcoming)
        {
            if (InvokeRequired) BeginInvoke(new Action(delegate { ApplyLyrics(main, upcoming); }));
            else ApplyLyrics(main, upcoming);
        }

        private void OnClearReceived() { OnLyricsReceived("", ""); }

        private void ApplyLyrics(string main, string upcoming)
        {
            _overlay.subLabel.DisplayText  = main;
            _overlay.subLabel.UpcomingText = upcoming;
            _overlay.ForceRedraw();
        }

        private void UpdateStatus()
        {
            if (_server == null) return;

            if (_server.IsRunning)
            {
                _lblStatus.Text      = "\u25CF  Server running  \u2014  port " + _server.Port;
                _lblStatus.ForeColor = Color.Green;
            }
            else
            {
                _lblStatus.Text      = "\u25CF  Server NOT running";
                _lblStatus.ForeColor = Color.Red;
            }

            if (_server.LastReceived != default(DateTime))
            {
                double s       = (DateTime.Now - _server.LastReceived).TotalSeconds;
                string ago     = s < 3 ? "just now" : (s < 60 ? ((int)s) + "s ago" : "idle");
                string preview = s < 4 && _server.LastMain != null
                    ? " \u2014 \u201C" + Trunc(_server.LastMain, 38) + "\u201D"
                    : "";
                _lblLast.Text = "Last update: " + ago + preview;
            }
            else
            {
                _lblLast.Text = "Waiting for data from browser...  (open a tab with a userscript)";
            }
        }

        private void UpdateEndpointLabel()
        {
            int p = _server != null ? _server.Port : (int)_numPort.Value;
            _lblEndpoints.Text =
                "POST http://localhost:" + p + "/subtitle\r\n" +
                "  Body: {\"main\":\"...\",\"upcoming\":\"...\"}\r\n\r\n" +
                "POST http://localhost:" + p + "/clear\r\n" +
                "GET  http://localhost:" + p + "/ping";
        }

        private void UpdateToggleText()
        {
            _btnToggle.Text = _overlay.Visible ? "\u266B Hide Overlay" : "\u266B Show Overlay";
        }

        private void UpdateLabelVisuals()
        {
            if (_overlay == null) return;
            SubtitleLabel l = _overlay.subLabel;

            l.Font         = new Font("Segoe UI", (float)_numSize.Value, FontStyle.Bold);
            l.MainColor    = _btnMainColor.BackColor;
            l.ShowStroke   = _chkStroke.Checked;
            l.StrokeColor  = _btnStrColor.BackColor;
            l.StrokeWidth  = (int)_numStrWidth.Value;
            l.ShowUpcoming = _chkUpc.Checked;
            l.ShowUpcStroke = _chkUpcStroke.Checked;
            l.UpcColor     = _btnUpcColor.BackColor;
            l.UpcPos       = _cmbUpcPos.SelectedIndex;
            l.UpcGap       = (int)_numUpcGap.Value;
            l.TextAlignment = _cmbHAlign.SelectedIndex == 0 ? StringAlignment.Near
                            : _cmbHAlign.SelectedIndex == 2 ? StringAlignment.Far
                            : StringAlignment.Center;
            l.LineAlignment = _cmbVAlign.SelectedIndex == 0 ? StringAlignment.Near
                            : _cmbVAlign.SelectedIndex == 1 ? StringAlignment.Center
                            : StringAlignment.Far;
            _overlay.ForceRedraw();
        }

        private void OnDragToggle(object sender, EventArgs e)
        {
            _dragMode          = !_dragMode;
            _btnDrag.Text      = _dragMode ? "\u283F Lock Overlay" : "\u283F Drag Mode";
            _btnDrag.BackColor = _dragMode ? Color.LightGreen      : Color.LightCoral;
            _overlay.SetDraggable(_dragMode);
        }

        private void PickColor(object sender, EventArgs e)
        {
            Button btn = (Button)sender;
            using (ColorDialog cd = new ColorDialog() { Color = btn.BackColor })
            {
                if (cd.ShowDialog() == DialogResult.OK) { btn.BackColor = cd.Color; UpdateLabelVisuals(); }
            }
        }

        private static string Trunc(string s, int max)
        {
            if (s == null) return "";
            return s.Length <= max ? s : s.Substring(0, max - 1) + "\u2026";
        }

        private string CfgPath()
        {
            string d = Path.Combine(Application.StartupPath, "config");
            if (!Directory.Exists(d)) Directory.CreateDirectory(d);
            return Path.Combine(d, "settings.ini");
        }

        private void SaveConfig()
        {
            try
            {
                using (StreamWriter w = new StreamWriter(CfgPath()))
                {
                    w.WriteLine("Port="        + _numPort.Value);
                    w.WriteLine("MainColor="   + _btnMainColor.BackColor.ToArgb());
                    w.WriteLine("FontSize="    + _numSize.Value);
                    w.WriteLine("StrokeEn="    + _chkStroke.Checked);
                    w.WriteLine("StrColor="    + _btnStrColor.BackColor.ToArgb());
                    w.WriteLine("StrWidth="    + _numStrWidth.Value);
                    w.WriteLine("UpcEn="       + _chkUpc.Checked);
                    w.WriteLine("UpcStrokeEn=" + _chkUpcStroke.Checked);
                    w.WriteLine("UpcColor="    + _btnUpcColor.BackColor.ToArgb());
                    w.WriteLine("UpcPos="      + _cmbUpcPos.SelectedIndex);
                    w.WriteLine("UpcGap="      + _numUpcGap.Value);
                    w.WriteLine("AlignH="      + _cmbHAlign.SelectedIndex);
                    w.WriteLine("AlignV="      + _cmbVAlign.SelectedIndex);
                    w.WriteLine("ShowOverlay=" + _overlay.Visible);
                    w.WriteLine("PosX="        + _overlay.Location.X);
                    w.WriteLine("PosY="        + _overlay.Location.Y);
                }
            }
            catch { }
        }

        private void LoadConfig()
        {
            string path = CfgPath();
            if (!File.Exists(path)) return;
            try
            {
                foreach (string raw in File.ReadAllLines(path))
                {
                    string[] parts = raw.Trim().Split(new char[] { '=' }, 2);
                    if (parts.Length < 2) continue;
                    string k = parts[0]; string v = parts[1];
                    int iv; bool bv;

                    if      (k == "Port"        && int.TryParse(v,  out iv)) _numPort.Value           = Math.Max(1024, Math.Min(65535, iv));
                    else if (k == "MainColor"   && int.TryParse(v,  out iv)) _btnMainColor.BackColor  = Color.FromArgb(iv);
                    else if (k == "FontSize"    && int.TryParse(v,  out iv)) _numSize.Value           = Math.Max(10, Math.Min(120, iv));
                    else if (k == "StrokeEn"    && bool.TryParse(v, out bv)) _chkStroke.Checked       = bv;
                    else if (k == "StrColor"    && int.TryParse(v,  out iv)) _btnStrColor.BackColor   = Color.FromArgb(iv);
                    else if (k == "StrWidth"    && int.TryParse(v,  out iv)) _numStrWidth.Value       = Math.Max(1, Math.Min(15, iv));
                    else if (k == "UpcEn"       && bool.TryParse(v, out bv)) _chkUpc.Checked          = bv;
                    else if (k == "UpcStrokeEn" && bool.TryParse(v, out bv)) _chkUpcStroke.Checked    = bv;
                    else if (k == "UpcColor"    && int.TryParse(v,  out iv)) _btnUpcColor.BackColor   = Color.FromArgb(iv);
                    else if (k == "UpcPos"      && int.TryParse(v,  out iv)) _cmbUpcPos.SelectedIndex = Math.Min(1, Math.Max(0, iv));
                    else if (k == "UpcGap"      && int.TryParse(v,  out iv)) _numUpcGap.Value         = Math.Max(-50, Math.Min(100, iv));
                    else if (k == "AlignH"      && int.TryParse(v,  out iv)) _cmbHAlign.SelectedIndex = Math.Min(2, Math.Max(0, iv));
                    else if (k == "AlignV"      && int.TryParse(v,  out iv)) _cmbVAlign.SelectedIndex = Math.Min(2, Math.Max(0, iv));
                    else if (k == "ShowOverlay" && bool.TryParse(v, out bv)) _overlay.Visible         = bv;
                    else if (k == "PosX"        && int.TryParse(v,  out iv)) { _savedX = iv; _hasSavedPos = true; }
                    else if (k == "PosY"        && int.TryParse(v,  out iv))   _savedY = iv;
                }
                if (_hasSavedPos) _overlay.Location = new Point(_savedX, _savedY);
                UpdateToggleText();
            }
            catch { }
        }

        private void OnClosing(object sender, FormClosingEventArgs e)
        {
            SaveConfig();
            _statusTimer.Stop();
            if (_server != null) _server.Stop();
            _overlay.Close();
        }
    }

    internal static class NativeMethods
    {
        [System.Runtime.InteropServices.DllImport("user32.dll")]
        public static extern int SendMessage(IntPtr hWnd, int Msg, int wParam, int lParam);
        [System.Runtime.InteropServices.DllImport("user32.dll")]
        public static extern bool ReleaseCapture();
    }
}