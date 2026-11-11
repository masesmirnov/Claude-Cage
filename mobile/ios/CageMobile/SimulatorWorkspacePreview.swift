// In-memory design preview. Compiled only for the simulator; never pairs a host.
#if targetEnvironment(simulator)
import SwiftUI
import WebKit

enum SimulatorWorkspacePreview {
    final class Preview: NSObject, WKURLSchemeHandler, WKNavigationDelegate {
        func webView(_ webView: WKWebView, start urlSchemeTask: WKURLSchemeTask) {
            guard let url = urlSchemeTask.request.url,
                  let root = Bundle.main.url(forResource: "mobile-ui", withExtension: nil) else {return}
            let file = root.appendingPathComponent(url.path == "/" ? "mobile.html" : String(url.path.dropFirst())).standardizedFileURL
            guard file.path.hasPrefix(root.path + "/"), let data = try? Data(contentsOf: file) else {
                urlSchemeTask.didFailWithError(URLError(.fileDoesNotExist)); return
            }
            let types = ["html": "text/html", "js": "text/javascript", "css": "text/css", "png": "image/png"]
            urlSchemeTask.didReceive(URLResponse(url: url, mimeType: types[file.pathExtension] ?? "application/octet-stream",
                                                 expectedContentLength: data.count, textEncodingName: "utf-8"))
            urlSchemeTask.didReceive(data); urlSchemeTask.didFinish()
        }
        func webView(_ webView: WKWebView, stop urlSchemeTask: WKURLSchemeTask) {}
        func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction,
                     decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
            decisionHandler(action.request.url?.scheme == "cage-preview" ? .allow : .cancel)
        }
    }
    static func makeWebView(model: ConnectionModel, id: String) -> (web: WKWebView, delegate: Preview) {
        let delegate = Preview()
        let origin = URL(string: "cage-preview://app/")!
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .nonPersistent()
        config.applicationNameForUserAgent = "CageMobile/1"
        config.setURLSchemeHandler(delegate, forURLScheme: "cage-preview")
        config.userContentController.add(DeviceWebBridge(model: model, id: id, origin: origin), name: "cageDevices")
        config.userContentController.addUserScript(WKUserScript(source: fixture, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        let view = WKWebView(frame: .zero, configuration: config)
        view.scrollView.contentInsetAdjustmentBehavior = .never
        view.navigationDelegate = delegate
        view.load(URLRequest(url: origin))
        return (view, delegate)
    }

    static let fixture = #"""
    (() => {
      const projects = [{name: "Cage", path: "/sample-project/cage"}, {name: "Personal website", path: "/sample-project/website"}];
      let sequence = 0;
      const uuid = () => "preview-" + (++sequence);
      if (!crypto.randomUUID) crypto.randomUUID = uuid;
      const snapshot = (id, workspace, title, turns = []) => ({id, workspace, title, turns,
        revision: 1, generation: "simulator-preview", updated_at: new Date().toISOString()});
      const sessions = [
        snapshot("preview-ui", projects[0].path, "Check the mobile UI", [{id: "turn-ui", prompt: "Help me check the mobile layout and sidebar.",
          text: "This is a sample session. You can look at message layout, the input box, and project switching.\n\nYou can also start a new session and send a message to see how it works.", status: "completed"}]),
        snapshot("preview-approval", projects[0].path, "Tool approval example", [{id: "turn-approval", prompt: "List the project directory.", text: "The following tool call needs confirmation.",
          status: "running", approval: {id: "approval-demo", tool: "Bash", input: {command: "ls -la", description: "List the sample project files"}}}]),
        snapshot("preview-website", projects[1].path, "Adjust the home page layout", [{id: "turn-website", prompt: "Check the spacing of the home page title.",
          text: "This is a sample session for the second project.", status: "completed"}])
      ];
      window.fetch = async (input, options = {}) => {
        const url = new URL(typeof input === "string" ? input : input.url, location.href);
        const path = url.pathname.replace("/api/mobile/cli", "");
        const body = options.body ? JSON.parse(options.body) : null;
        let value;
        if (path === "/projects") value = {host: window.__cageDevices?.devices.find(d => d.id === window.__cageDevices.current)?.name || "Simulator preview", ready: true, projects};
        else if (path === "/sessions" && !body) value = {sessions};
        else if (path === "/sessions") {
          value = snapshot(uuid(), body.workspace, "New session"); sessions.unshift(value);
        } else {
          const [, , id, action] = path.split("/");
          value = sessions.find(s => s.id === id);
          if (!value) return new Response("The sample session does not exist", {status: 404, headers: {"Content-Type": "text/plain"}});
          if (action === "metadata") {
            if (body.title !== undefined) value.title = value.custom_title = body.title;
            if (body.pinned !== undefined) value.pinned = body.pinned;
            value.metadata_set = true;
          } else if (action === "delete") {
            sessions.splice(sessions.indexOf(value), 1);
            return new Response(JSON.stringify({ok: true}), {headers: {"Content-Type": "application/json"}});
          } else if (action === "messages") {
            if (!value.custom_title) value.title = body.text.slice(0, 30);
            value.turns.push({id: body.request_id, prompt: body.text, status: "completed",
              text: "Sample message received. This is a simulator UI preview: no computer is connected and no model was called."});
          } else if (action === "approval") {
            const turn = value.turns.at(-1);
            turn.status = "completed"; delete turn.approval;
            turn.text = body.allow ? "Sample approval allowed. The command is not actually run." : "Sample approval denied.";
          } else if (action === "stop") value.turns.at(-1).status = "stopped";
          if (body) {value.revision++; value.updated_at = new Date().toISOString();}
        }
        return new Response(JSON.stringify(value), {headers: {"Content-Type": "application/json"}});
      };
    })();
    """#
}
#endif
