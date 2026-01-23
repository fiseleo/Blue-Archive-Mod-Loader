using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Text.Json;
using System.Threading.Tasks;
using Microsoft.Web.WebView2.WinForms;

namespace Blue_Archive_Mod_Manager_C_.Utils
{
    public class WebViewBridge
    {
        private readonly WebView2 _webView;
        private readonly Dictionary<string, Func<JsonElement, Task<object?>>> _handlers;

        public WebViewBridge(WebView2 webView)
        {
            _webView = webView;
            _handlers = new Dictionary<string, Func<JsonElement, Task<object?>>>();
            InitializeWebMessageChannel();
        }

        private void InitializeWebMessageChannel()
        {
            _webView.WebMessageReceived += async (sender, args) =>
            {
                try
                {
                    Debug.WriteLine($"[WebViewBridge] Received message: {args.WebMessageAsJson}");
                    var message = JsonSerializer.Deserialize<Dictionary<string, JsonElement>>(args.WebMessageAsJson);
                    
                    if (message != null && message.TryGetValue("method", out var methodElement))
                    {
                        var method = methodElement.GetString();
                        var payload = message.ContainsKey("payload") ? message["payload"] : JsonSerializer.SerializeToElement(new object());
                        var id = message.ContainsKey("id") ? message["id"].GetString() : null;

                        Debug.WriteLine($"[WebViewBridge] Processing method: {method}, id: {id}");

                        if (!string.IsNullOrEmpty(method) && _handlers.ContainsKey(method))
                        {
                            Debug.WriteLine($"[WebViewBridge] Handler found for: {method}");
                            try
                            {
                                var result = await _handlers[method](payload);
                                Debug.WriteLine($"[WebViewBridge] Handler returned result for: {method}");
                                SendResponse(method, result, null, id);
                            }
                            catch (Exception handlerEx)
                            {
                                Debug.WriteLine($"[WebViewBridge] Handler error for {method}: {handlerEx.Message}");
                                SendResponse(method, null, handlerEx.Message, id);
                            }
                        }
                        else
                        {
                            Debug.WriteLine($"[WebViewBridge] No handler for: {method}");
                            SendResponse(method, null, $"Unknown method: {method}", id);
                        }
                    }
                    else
                    {
                        Debug.WriteLine("[WebViewBridge] Invalid message format");
                    }
                }
                catch (Exception ex)
                {
                    Debug.WriteLine($"[WebViewBridge] Error processing message: {ex.Message}\n{ex.StackTrace}");
                }
            };
        }

        private void SendResponse(string method, object? result, string? error, string? id)
        {
            try
            {
                var response = new { method, result, error };
                var responseJson = JsonSerializer.Serialize(new { method = "response", data = response, id });
                
                // Escape the JSON for safe inclusion in JavaScript string
                var escapedJson = responseJson.Replace("\\", "\\\\").Replace("\"", "\\\"");
                
                var script = $@"
                    (function() {{
                        try {{
                            var data = JSON.parse(""{escapedJson}"");
                            if (window.CSharpBridge && window.CSharpBridge._pendingResponses) {{
                                var pending = window.CSharpBridge._pendingResponses.get(data.id);
                                if (pending) {{
                                    clearTimeout(pending.timeout);
                                    console.log('[Response] Resolving:', data.data.method, data.id);
                                    pending.resolve(data.data.result || data.data.error);
                                    window.CSharpBridge._pendingResponses.delete(data.id);
                                }}
                            }}
                        }} catch(e) {{
                            console.error('[Response] Error:', e);
                        }}
                    }})();
                ";
                
                _webView.ExecuteScriptAsync(script);
                Debug.WriteLine($"[WebViewBridge] Sent response for: {method}");
            }
            catch (Exception ex)
            {
                Debug.WriteLine($"[WebViewBridge] Error sending response: {ex.Message}");
            }
        }

        public void RegisterHandler(string method, Func<JsonElement, Task<object?>> handler)
        {
            _handlers[method] = handler;
            Debug.WriteLine($"[WebViewBridge] Registered handler for: {method}");
        }

        public async Task SendNotificationAsync(string eventName, object? data)
        {
            try
            {
                var notificationJson = JsonSerializer.Serialize(new { method = eventName, data });
                var escapedJson = notificationJson.Replace("\\", "\\\\").Replace("\"", "\\\"");
                
                var script = $@"
                    (function() {{
                        try {{
                            var notification = JSON.parse(""{escapedJson}"");
                            if (window.chrome && window.chrome.webview) {{
                                window.chrome.webview.postMessage(notification);
                                console.log('[Notification] Sent:', notification.method);
                            }}
                        }} catch(e) {{
                            console.error('[Notification] Error:', e);
                        }}
                    }})();
                ";
                
                await _webView.ExecuteScriptAsync(script);
                Debug.WriteLine($"[WebViewBridge] Sent notification: {eventName}");
            }
            catch (Exception ex)
            {
                Debug.WriteLine($"[WebViewBridge] Error sending notification: {ex.Message}");
            }
        }
    }
}
