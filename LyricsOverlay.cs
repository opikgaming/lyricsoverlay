// LyricsOverlay.cs — Lyrics display overlay, driven by browser userscripts via HTTP
// Compile: compile.bat  (csc.exe .NET 4)
// No audio player — browser handles music, this app ONLY displays lyrics.

using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Text;
using System.Windows.Forms;
using System.IO;
using System.Net;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;

namespace LyricsOverlay
{
    // ─────────────────────────────────────────────────────────────────────────
    //  ENTRY POINT
    // ─────────────────────────────────────────────────────────────────────────
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

    // ─────────────────────────────────────────────────────────────────────────
    //  SUBTITLE LABEL  (same rendering logic as original)
    // ─────────────────────────────────────────────────────────────────────────
    public class SubtitleLabel : Control
    {
        public string DisplayText  = "";
        public Color  MainColor    = Color.Yellow;

        public bool   ShowStroke   = false;
        public Color  StrokeColor  = Color.Black;
        public int    StrokeWidth  = 3;

        public bool   ShowUpcoming = false;
        public string UpcomingText = "";
        public Color  UpcColor     = Color.Gray;
        public int    UpcPos       = 0;   // 0=above, 1=below

        public StringAlignment TextAlignment = StringAlignment.Center;
        public StringAlignment LineAlignment = StringAlignment.Far;
        public Color ChromaKey = Color.Magenta;

        private Font         _upcFont;
        private SolidBrush   _mainBrush, _upcBrush;
        private Pen          _strokePen;
        private StringFormat _sf;
        private GraphicsPath _cachedPath;
        private RectangleF   _cachedMainRect, _cachedUpcRect;
        private float        _emSize;

        public SubtitleLabel()
        {
            SetStyle(ControlStyles.UserPaint | ControlStyles.AllPaintingInWmPaint |
                     ControlStyles.OptimizedDoubleBuffer | ControlStyles.SupportsTransparentBackColor, true);
            BackColor = Color.Transparent;
            Font = new Font("Segoe UI", 36, FontStyle.Bold);
            UpdateUpcFont();
            UpdateBrushes();
        }

        public void UpdateUpcFont()
        {
            if (_upcFont != null) _upcFont.Dispose();
            _upcFont = new Font(Font.FontFamily, Font.Size * 0.6f, FontStyle.Regular);
        }

        public void UpdateBrushes()
        {
            if (_mainBrush != null) _mainBrush.Dispose();
            if (_strokePen  != null) _strokePen.Dispose();
            if (_upcBrush   != null) _upcBrush.Dispose();
            if (_sf         != null) _sf.Dispose();

            _mainBrush = new SolidBrush(MainColor);
            _strokePen = new Pen(StrokeColor, StrokeWidth) { LineJoin = LineJoin.Miter };
            _upcBrush  = new SolidBrush(UpcColor);

            _sf = new StringFormat();
            _sf.Alignment     = TextAlignment;
            _sf.LineAlignment = LineAlignment;

            using (Graphics g = CreateGraphics())
                _emSize = g.DpiY * Font.SizeInPoints / 72f;
        }

        public void RecalculatePath()
        {
            if (_cachedPath != null) { _cachedPath.Dispose(); _cachedPath = null; }

            _cachedMainRect = new RectangleF(0, 0, Width, Height);
            _cachedUpcRect  = new RectangleF(0, 0, Width, Height);

            if (ShowUpcoming && !string.IsNullOrEmpty(UpcomingText))
            {
                float shift = Font.Height * 0.7f;
                if (UpcPos == 0) {
                    if      (LineAlignment == StringAlignment.Near) _cachedMainRect.Y += shift;
                    else if (LineAlignment == StringAlignment.Far)  _cachedUpcRect.Y  -= shift;
                    else { _cachedMainRect.Y += shift / 2; _cachedUpcRect.Y -= shift / 2; }
                } else {
                    if      (LineAlignment == StringAlignment.Near) _cachedUpcRect.Y  += shift;
                    else if (LineAlignment == StringAlignment.Far)  _cachedMainRect.Y -= shift;
                    else { _cachedMainRect.Y -= shift / 2; _cachedUpcRect.Y += shift / 2; }
                }
            }

            if (ShowStroke && StrokeWidth > 0 && !string.IsNullOrEmpty(DisplayText))
            {
                _cachedPath = new GraphicsPath();
                _cachedPath.AddString(DisplayText, Font.FontFamily, (int)Font.Style, _emSize,
                                      _cachedMainRect, _sf);
            }
        }

        protected override void OnResize(EventArgs e) { base.OnResize(e); RecalculatePath(); }

        protected override void OnPaint(PaintEventArgs e)
        {
            e.Graphics.Clear(ChromaKey);
            if (string.IsNullOrEmpty(DisplayText) && string.IsNullOrEmpty(UpcomingText)) return;

            e.Graphics.TextRenderingHint = TextRenderingHint.SingleBitPerPixelGridFit;
            e.Graphics.SmoothingMode     = SmoothingMode.None;
            e.Graphics.InterpolationMode = InterpolationMode.NearestNeighbor;
            e.Graphics.PixelOffsetMode   = PixelOffsetMode.None;

            if (ShowUpcoming && !string.IsNullOrEmpty(UpcomingText))
                e.Graphics.DrawString(UpcomingText, _upcFont, _upcBrush, _cachedUpcRect, _sf);

            if (string.IsNullOrEmpty(DisplayText)) return;

            if (ShowStroke && StrokeWidth > 0 && _cachedPath != null)
            {
                e.Graphics.DrawPath(_strokePen, _cachedPath);
                e.Graphics.FillPath(_mainBrush, _cachedPath);
            }
            else
            {
                e.Graphics.DrawString(DisplayText, Font, _mainBrush, _cachedMainRect, _sf);
            }
        }

        protected override void Dispose(bool disposing)
        {
            if (disposing)
            {
                if (_mainBrush  != null) _mainBrush.Dispose();
                if (_strokePen  != null) _strokePen.Dispose();
                if (_upcBrush   != null) _upcBrush.Dispose();
                if (_sf         != null) _sf.Dispose();
                if (_upcFont    != null) _upcFont.Dispose();
                if (_cachedPath != null) _cachedPath.Dispose();
            }
            base.Dispose(disposing);
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  OVERLAY FORM  (transparent topmost, click-through when not dragging)
    // ─────────────────────────────────────────────────────────────────────────
    public class OverlayForm : Form
    {
        public SubtitleLabel subLabel;
        private bool  _draggable, _dragging;
        private Point _dragCursor, _dragOrigin;

        public static Point DefaultLocation() { return new Point(0, Screen.PrimaryScreen.Bounds.Height - 250); }
        public static Size  DefaultSize()     { return new Size(Screen.PrimaryScreen.Bounds.Width, 200); }

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
            subLabel.MouseDown += SubLabel_MouseDown;
            subLabel.MouseMove += SubLabel_MouseMove;
            subLabel.MouseUp   += SubLabel_MouseUp;

            Controls.Add(subLabel);
            SetDraggable(false);
        }

        public void ResetPosition() { Size = DefaultSize(); Location = DefaultLocation(); }
        public void ForceRedraw()   { subLabel.RecalculatePath(); subLabel.Invalidate(); }

        public void SetDraggable(bool drag)
        {
            _draggable           = drag;
            subLabel.ChromaKey   = drag ? Color.DimGray  : Color.Magenta;
            BackColor            = drag ? Color.DimGray  : Color.Magenta;
            TransparencyKey      = drag ? Color.Empty    : Color.Magenta;
            Opacity              = drag ? 0.65           : 1.0;
            subLabel.DisplayText = drag ? "\u283F DRAG ME \u283F" : "";
            subLabel.UpdateBrushes();
            ForceRedraw();
            RecreateHandle();
        }

        private void SubLabel_MouseDown(object sender, MouseEventArgs e)
        {
            if (_draggable && e.Button == MouseButtons.Left) { _dragging = true; _dragCursor = Cursor.Position; _dragOrigin = Location; }
        }
        private void SubLabel_MouseMove(object sender, MouseEventArgs e)
        {
            if (!_dragging) return;
            Point d = Point.Subtract(Cursor.Position, new Size(_dragCursor));
            Location = Point.Add(_dragOrigin, new Size(d));
        }
        private void SubLabel_MouseUp(object sender, MouseEventArgs e) { _dragging = false; }

        protected override CreateParams CreateParams
        {
            get
            {
                CreateParams cp = base.CreateParams;
                if (!_draggable) cp.ExStyle |= 0x80000 | 0x20; // WS_EX_LAYERED | WS_EX_TRANSPARENT
                return cp;
            }
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  HTTP SERVER  — accepts POST /subtitle {main, upcoming}
    // ─────────────────────────────────────────────────────────────────────────
    public class LyricsHttpServer
    {
        private HttpListener _listener;

        public int      Port        { get; private set; }
        public bool     IsRunning   { get; private set; }
        public string   LastMain    { get; private set; }
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

            // Queue next accept right away
            try { _listener.BeginGetContext(OnContext, null); } catch { return; }

            try
            {
                // CORS — allows browser (and GM_xmlhttpRequest) to call us
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

        // Minimal JSON string extractor — no external deps needed
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

    // ─────────────────────────────────────────────────────────────────────────
    //  CONFIG FORM  — server status + display settings
    // ─────────────────────────────────────────────────────────────────────────
    public class ConfigForm : Form
    {
        private OverlayForm      _overlay;
        private LyricsHttpServer _server;
        private Timer            _statusTimer;
        private bool             _dragMode = false;

        // Status area
        private Label  _lblStatus, _lblLast;
        private Button _btnToggle;

        // Display tab controls
        private Button        _btnMainColor, _btnStrColor, _btnUpcColor;
        private CheckBox      _chkStroke, _chkUpc;
        private NumericUpDown _numSize, _numStrWidth;
        private ComboBox      _cmbHAlign, _cmbVAlign, _cmbUpcPos;
        private Button        _btnDrag, _btnReset;

        // Server tab
        private NumericUpDown _numPort;
        private Label         _lblEndpoints;

        // Saved overlay position
        private int  _savedX, _savedY;
        private bool _hasSavedPos;

        public ConfigForm()
        {
            Text            = "LyricsOverlay \u2014 Browser Bridge";
            Size            = new Size(420, 480);
            FormBorderStyle = FormBorderStyle.FixedSingle;
            MinimizeBox     = true;
            MaximizeBox     = false;
            StartPosition   = FormStartPosition.CenterScreen;
            FormClosing    += OnClosing;

            // ── Top status strip ──────────────────────────────────────────────
            _lblStatus = new Label()
            {
                Location  = new Point(10, 10),
                Size      = new Size(385, 20),
                Font      = new Font("Segoe UI", 9, FontStyle.Bold),
                ForeColor = Color.Gray
            };
            _lblLast = new Label()
            {
                Location  = new Point(10, 32),
                Size      = new Size(385, 16),
                Font      = new Font("Segoe UI", 7.5f),
                ForeColor = Color.Gray
            };
            _btnToggle = new Button()
            {
                Text     = "\u266B Hide Overlay",
                Location = new Point(10, 52),
                Size     = new Size(385, 28)
            };
            _btnToggle.Click += delegate { _overlay.Visible = !_overlay.Visible; UpdateToggleText(); };

            Controls.Add(_lblStatus);
            Controls.Add(_lblLast);
            Controls.Add(_btnToggle);

            // ── Tab control ──────────────────────────────────────────────────
            TabControl tab = new TabControl() { Location = new Point(5, 88), Size = new Size(398, 350) };
            Controls.Add(tab);

            TabPage pgServer  = new TabPage("\u26A1 Server & Info");
            TabPage pgDisplay = new TabPage("\u2699 Display");
            tab.TabPages.Add(pgServer);
            tab.TabPages.Add(pgDisplay);

            BuildServerTab(pgServer);
            BuildDisplayTab(pgDisplay);

            // ── Overlay ──────────────────────────────────────────────────────
            _overlay = new OverlayForm();
            _overlay.Show();

            // ── Load config (before starting server so port is ready) ─────────
            LoadConfig();

            // ── Start HTTP server ─────────────────────────────────────────────
            _server = new LyricsHttpServer(
                (int)_numPort.Value,
                OnLyricsReceived,
                OnClearReceived
            );
            bool ok = _server.Start();
            if (!ok)
                MessageBox.Show(
                    "Could not start HTTP server on port " + _numPort.Value + ".\n" +
                    "Another program may be using that port.\nTry changing the port.",
                    "Server Error", MessageBoxButtons.OK, MessageBoxIcon.Warning);

            UpdateEndpointLabel();
            UpdateLabelVisuals();

            // ── Status ticker ─────────────────────────────────────────────────
            _statusTimer = new Timer() { Interval = 800 };
            _statusTimer.Tick += delegate { UpdateStatus(); };
            _statusTimer.Start();
            UpdateStatus();
        }

        // ── Tab builders ─────────────────────────────────────────────────────

        private void BuildServerTab(TabPage p)
        {
            Label h1 = Hdr("HTTP Listener", 10, 12);

            Label lPort = new Label() { Text = "Port:", Location = new Point(10, 40), AutoSize = true };
            _numPort = new NumericUpDown()
            {
                Location = new Point(55, 37), Width = 80,
                Minimum = 1024, Maximum = 65535, Value = 7331
            };
            Button btnRestart = new Button()
            {
                Text = "Restart Server", Location = new Point(150, 36), Size = new Size(105, 24),
                BackColor = Color.LightCyan
            };
            btnRestart.Click += delegate
            {
                _server.Stop();
                _server = new LyricsHttpServer((int)_numPort.Value, OnLyricsReceived, OnClearReceived);
                _server.Start();
                UpdateEndpointLabel();
                UpdateStatus();
            };

            Label h2 = Hdr("Endpoints", 10, 74);
            _lblEndpoints = new Label()
            {
                Location  = new Point(10, 92),
                Size      = new Size(365, 100),
                Font      = new Font("Courier New", 7.5f),
                ForeColor = Color.DimGray
            };

            Label h3 = Hdr("Supported Platforms (install userscripts!)", 10, 200);
            Label lPlat = new Label()
            {
                Text      = "\u2705 YouTube            — full caption track, synced\r\n" +
                            "\u2705 Spotify Web         — lyrics API intercept, synced\r\n" +
                            "\u2705 YouTube Music       — timed lyrics + DOM fallback\r\n" +
                            "\u26A0 Deezer / Tidal      — DOM scrape (best-effort)\r\n" +
                            "\u274C SoundCloud          — lyrics rarely available",
                Location  = new Point(10, 218),
                Size      = new Size(370, 100),
                ForeColor = Color.DimGray,
                Font      = new Font("Segoe UI", 8f)
            };

            p.Controls.AddRange(new Control[] { h1, lPort, _numPort, btnRestart, h2, _lblEndpoints, h3, lPlat });
        }

        private void BuildDisplayTab(TabPage p)
        {
            Label h1 = Hdr("Main Text", 10, 12);
            _btnMainColor = Btn("Text Color", 10, 35, Color.Yellow);
            Label lSz = new Label() { Text = "Size:", Location = new Point(115, 40), AutoSize = true };
            _numSize = new NumericUpDown() { Location = new Point(160, 37), Width = 65, Minimum = 10, Maximum = 120, Value = 36 };

            Label h2 = Hdr("Outline / Stroke", 10, 78);
            _chkStroke  = new CheckBox() { Text = "Enable", Location = new Point(10, 98), Width = 65 };
            _btnStrColor = Btn("Color", 80, 95, Color.Black);
            Label lW    = new Label() { Text = "Width:", Location = new Point(162, 99), AutoSize = true };
            _numStrWidth = new NumericUpDown() { Location = new Point(210, 96), Width = 55, Minimum = 1, Maximum = 15, Value = 3 };

            Label h3 = Hdr("Upcoming Lyric Line", 10, 135);
            _chkUpc    = new CheckBox() { Text = "Enable", Location = new Point(10, 155), Width = 65 };
            _btnUpcColor = Btn("Color", 80, 152, Color.LightGray);
            _cmbUpcPos   = new ComboBox() { Location = new Point(162, 153), Width = 120, DropDownStyle = ComboBoxStyle.DropDownList };
            _cmbUpcPos.Items.AddRange(new object[] { "Upcoming: Above", "Upcoming: Below" });
            _cmbUpcPos.SelectedIndex = 0;

            Label h4 = Hdr("Alignment", 10, 192);
            _cmbHAlign = new ComboBox() { Location = new Point(10, 210), Width = 90, DropDownStyle = ComboBoxStyle.DropDownList };
            _cmbHAlign.Items.AddRange(new object[] { "Left", "Center", "Right" }); _cmbHAlign.SelectedIndex = 1;
            _cmbVAlign = new ComboBox() { Location = new Point(110, 210), Width = 90, DropDownStyle = ComboBoxStyle.DropDownList };
            _cmbVAlign.Items.AddRange(new object[] { "Top", "Center", "Bottom" }); _cmbVAlign.SelectedIndex = 2;

            Label h5 = Hdr("Overlay Window", 10, 248);
            _btnDrag  = new Button() { Text = "\u283F Drag Mode", Location = new Point(10,  266), Size = new Size(120, 28), BackColor = Color.LightCoral };
            _btnReset = new Button() { Text = "\u21BA Reset Pos",  Location = new Point(138, 266), Size = new Size(120, 28), BackColor = Color.LightSteelBlue };

            _btnMainColor.Click += PickColor;
            _btnStrColor.Click  += PickColor;
            _btnUpcColor.Click  += PickColor;

            EventHandler upd = delegate { UpdateLabelVisuals(); };
            _numSize.ValueChanged      += upd;
            _numStrWidth.ValueChanged  += upd;
            _chkStroke.CheckedChanged  += upd;
            _chkUpc.CheckedChanged     += upd;
            _cmbUpcPos.SelectedIndexChanged += upd;
            _cmbHAlign.SelectedIndexChanged += upd;
            _cmbVAlign.SelectedIndexChanged += upd;

            _btnDrag.Click  += OnDragToggle;
            _btnReset.Click += delegate { _overlay.ResetPosition(); if (_dragMode) OnDragToggle(null, null); };

            p.Controls.AddRange(new Control[] {
                h1, _btnMainColor, lSz, _numSize,
                h2, _chkStroke, _btnStrColor, lW, _numStrWidth,
                h3, _chkUpc, _btnUpcColor, _cmbUpcPos,
                h4, _cmbHAlign, _cmbVAlign,
                h5, _btnDrag, _btnReset
            });
        }

        // ── Helpers ──────────────────────────────────────────────────────────

        private static Label Hdr(string text, int x, int y)
        {
            return new Label() {
                Text      = text,
                Location  = new Point(x, y),
                AutoSize  = true,
                Font      = new Font("Segoe UI", 8, FontStyle.Bold),
                ForeColor = Color.DimGray
            };
        }

        private static Button Btn(string text, int x, int y, Color back)
        {
            return new Button() { Text = text, Location = new Point(x, y), Width = 80, BackColor = back };
        }

        // ── HTTP callbacks (called from thread pool — must BeginInvoke) ──────

        private void OnLyricsReceived(string main, string upcoming)
        {
            if (InvokeRequired)
                BeginInvoke(new Action(delegate { ApplyLyrics(main, upcoming); }));
            else
                ApplyLyrics(main, upcoming);
        }

        private void OnClearReceived()
        {
            OnLyricsReceived("", "");
        }

        private void ApplyLyrics(string main, string upcoming)
        {
            _overlay.subLabel.DisplayText  = main;
            _overlay.subLabel.UpcomingText = upcoming;
            _overlay.ForceRedraw();
        }

        // ── UI update helpers ────────────────────────────────────────────────

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
                double s   = (DateTime.Now - _server.LastReceived).TotalSeconds;
                string ago = s < 3 ? "just now" : (s < 60 ? ((int)s) + "s ago" : "idle");
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
                "     Body: {\"main\":\"...\",\"upcoming\":\"...\"}\r\n\r\n" +
                "POST http://localhost:" + p + "/clear\r\n" +
                "GET  http://localhost:" + p + "/ping  \u2192 pong";
        }

        private void UpdateToggleText()
        {
            _btnToggle.Text = _overlay.Visible ? "\u266B Hide Overlay" : "\u266B Show Overlay";
        }

        private void UpdateLabelVisuals()
        {
            if (_overlay == null) return;
            SubtitleLabel l = _overlay.subLabel;

            l.MainColor = _btnMainColor.BackColor;
            l.Font      = new Font("Segoe UI", (float)_numSize.Value, FontStyle.Bold);
            l.UpdateUpcFont();

            l.ShowStroke  = _chkStroke.Checked;
            l.StrokeColor = _btnStrColor.BackColor;
            l.StrokeWidth = (int)_numStrWidth.Value;

            l.ShowUpcoming = _chkUpc.Checked;
            l.UpcColor     = _btnUpcColor.BackColor;
            l.UpcPos       = _cmbUpcPos.SelectedIndex;

            l.TextAlignment = _cmbHAlign.SelectedIndex == 0 ? StringAlignment.Near
                            : _cmbHAlign.SelectedIndex == 2 ? StringAlignment.Far
                            :                                 StringAlignment.Center;
            l.LineAlignment = _cmbVAlign.SelectedIndex == 0 ? StringAlignment.Near
                            : _cmbVAlign.SelectedIndex == 1 ? StringAlignment.Center
                            :                                 StringAlignment.Far;

            l.UpdateBrushes();
            _overlay.ForceRedraw();
        }

        private void OnDragToggle(object sender, EventArgs e)
        {
            _dragMode        = !_dragMode;
            _btnDrag.Text     = _dragMode ? "\u283F Lock Overlay" : "\u283F Drag Mode";
            _btnDrag.BackColor = _dragMode ? Color.LightGreen : Color.LightCoral;
            _overlay.SetDraggable(_dragMode);
        }

        private void PickColor(object sender, EventArgs e)
        {
            Button btn = (Button)sender;
            ColorDialog cd = new ColorDialog() { Color = btn.BackColor };
            if (cd.ShowDialog() == DialogResult.OK) { btn.BackColor = cd.Color; UpdateLabelVisuals(); }
        }

        private static string Trunc(string s, int max)
        {
            if (s == null) return "";
            return s.Length <= max ? s : s.Substring(0, max - 1) + "\u2026";
        }

        // ── Config persist ───────────────────────────────────────────────────

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
                    w.WriteLine("Port="       + _numPort.Value);
                    w.WriteLine("MainColor="  + _btnMainColor.BackColor.ToArgb());
                    w.WriteLine("FontSize="   + _numSize.Value);
                    w.WriteLine("StrokeEn="   + _chkStroke.Checked);
                    w.WriteLine("StrColor="   + _btnStrColor.BackColor.ToArgb());
                    w.WriteLine("StrWidth="   + _numStrWidth.Value);
                    w.WriteLine("UpcEn="      + _chkUpc.Checked);
                    w.WriteLine("UpcColor="   + _btnUpcColor.BackColor.ToArgb());
                    w.WriteLine("UpcPos="     + _cmbUpcPos.SelectedIndex);
                    w.WriteLine("AlignH="     + _cmbHAlign.SelectedIndex);
                    w.WriteLine("AlignV="     + _cmbVAlign.SelectedIndex);
                    w.WriteLine("ShowOverlay="+ _overlay.Visible);
                    w.WriteLine("PosX="       + _overlay.Location.X);
                    w.WriteLine("PosY="       + _overlay.Location.Y);
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

                    if      (k == "Port"       && int.TryParse(v, out iv))  _numPort.Value          = Math.Max(1024, Math.Min(65535, iv));
                    else if (k == "MainColor"  && int.TryParse(v, out iv))  _btnMainColor.BackColor = Color.FromArgb(iv);
                    else if (k == "FontSize"   && int.TryParse(v, out iv))  _numSize.Value          = Math.Max(10, Math.Min(120, iv));
                    else if (k == "StrokeEn"   && bool.TryParse(v, out bv)) _chkStroke.Checked      = bv;
                    else if (k == "StrColor"   && int.TryParse(v, out iv))  _btnStrColor.BackColor  = Color.FromArgb(iv);
                    else if (k == "StrWidth"   && int.TryParse(v, out iv))  _numStrWidth.Value      = Math.Max(1, Math.Min(15, iv));
                    else if (k == "UpcEn"      && bool.TryParse(v, out bv)) _chkUpc.Checked         = bv;
                    else if (k == "UpcColor"   && int.TryParse(v, out iv))  _btnUpcColor.BackColor  = Color.FromArgb(iv);
                    else if (k == "UpcPos"     && int.TryParse(v, out iv))  _cmbUpcPos.SelectedIndex = Math.Min(1, Math.Max(0, iv));
                    else if (k == "AlignH"     && int.TryParse(v, out iv))  _cmbHAlign.SelectedIndex = Math.Min(2, Math.Max(0, iv));
                    else if (k == "AlignV"     && int.TryParse(v, out iv))  _cmbVAlign.SelectedIndex = Math.Min(2, Math.Max(0, iv));
                    else if (k == "ShowOverlay"&& bool.TryParse(v, out bv)) _overlay.Visible         = bv;
                    else if (k == "PosX"       && int.TryParse(v, out iv)) { _savedX = iv; _hasSavedPos = true; }
                    else if (k == "PosY"       && int.TryParse(v, out iv)) { _savedY = iv; }
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
}
