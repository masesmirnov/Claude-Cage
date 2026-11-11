import Foundation
import SwiftUI
import VisionKit
import AVFoundation
import UniformTypeIdentifiers
import WebKit
private var simulatorPreviewEnabled: Bool {
    #if targetEnvironment(simulator)
    return true
    #else
    return false
    #endif
}

struct ConnectedDevice: Identifiable {
    let id: String
    var name: String
    let connection: CMConnection?
    let webView: WKWebView
}

final class DeviceWebBridge: NSObject, WKScriptMessageHandler {
    weak var model: ConnectionModel?
    let id: String
    let origin: URL
    init(model: ConnectionModel, id: String, origin: URL) {self.model = model; self.id = id; self.origin = origin}
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let model, model.devices.contains(where: {$0.id == id && $0.webView === message.webView}),
              message.frameInfo.isMainFrame, let url = message.frameInfo.request.url,
              url.scheme == origin.scheme, url.host == origin.host, url.port == origin.port,
              let body = message.body as? [String: Any], let action = body["action"] as? String else {return}
        if action == "name" {
            if let name = body["name"] as? String {model.nameDevice(id, name)}
            return
        }
        guard model.showingWorkspace, model.selectedDeviceID == id else {return}
        if action == "home" {model.leaveWorkspace()}
    }
}

final class ConnectionModel: ObservableObject {

    @Published var relay = CMConnection.defaultRelay()
    @Published var pin = ""
    @Published var fingerprint = ""
    @Published var verified = false
    @Published var hasInvitation = false
    @Published var hasSaved = false
    @Published var needsTrust = false
    @Published var status = ""
    @Published var connecting = false
    @Published var session: CMConnection?
    @Published var devices: [ConnectedDevice] = []
    @Published var selectedDeviceID: String?
    @Published var showingWorkspace = false
    var selectedDevice: ConnectedDevice? {devices.first {$0.id == selectedDeviceID}}

    private var invitation: Invitation?
    private var imported: HostAccess?
    private var trusted: Host?
    private var generation = 0
    private var openArchivedAfterConnect = false
    private let trustKey = "independently-verified-host-v1"
    private let linkQueue = DispatchQueue(label: "CageMobile.connection")
    var canForget: Bool { trusted != nil }
    var canConnect: Bool { !connecting && !needsTrust && !fingerprint.isEmpty && (hasInvitation || hasSaved) }

    init() {
        if let data = UserDefaults.standard.data(forKey: trustKey), let host = try? JSONDecoder().decode(Host.self, from: data) {
            trusted = host; relay = host.relay; pin = host.pin
        }
        do {
            if let saved = try HostKeychain.read() {
                trusted = saved.host; relay = saved.host.relay; pin = saved.host.pin; hasSaved = true
            }
        } catch {
            status = "Could not read the saved connection. Unlock your phone and reopen the app."
        }
        if let selected = UserDefaults.standard.string(forKey:"preferred-relay") {relay = selected}
        DispatchQueue.global(qos: .userInitiated).async {
            do {
                let value = try CMConnection.deviceFingerprint()
                DispatchQueue.main.async { self.fingerprint = value }
            } catch {
                DispatchQueue.main.async { self.status = error.localizedDescription }
            }
        }
    }
    func pair(code: String) {
        guard !connecting else {return}
        connecting = true; generation += 1
        let attempt = generation
        let address = UserDefaults.standard.string(forKey: "preferred-relay") ?? trusted?.relay ?? CMConnection.defaultRelay()
        status = "Pairing with the computer…"
        linkQueue.async {
            let result = Result { () throws -> HostAccess in
                let data = Data(try CMConnection.pair(code: code, relay: address).utf8)
                guard case .persistent(let access) = try ConnectionFile.parse(data) else {throw InputError.invalid}
                return access
            }
            DispatchQueue.main.async {
                guard attempt == self.generation else {return}
                self.connecting = false
                do {
                    let saved = try result.get()
                    try HostKeychain.write(saved)
                    UserDefaults.standard.set(saved.host.relay,forKey:"preferred-relay")
                    self.trusted = saved.host; self.pin = saved.host.pin; self.relay = saved.host.relay
                    self.imported = nil; self.invitation = nil; self.hasInvitation = false
                    self.hasSaved = true; self.needsTrust = false; self.verified = false
                    self.connect()
                } catch { self.status = error.localizedDescription }
            }
        }
    }
    func saveRelay() {
        let input = relay.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let u = URLComponents(string: input), u.scheme?.lowercased() == "https",
              let host=u.host, !host.isEmpty, u.user==nil, u.password==nil, u.query==nil, u.fragment==nil,
              (u.path=="" || u.path=="/"), (1...65535).contains(u.port ?? 443) else {status="Enter a valid HTTPS address.";return}
        relay=input.hasSuffix("/") ? String(input.dropLast()) : input
        UserDefaults.standard.set(relay,forKey:"preferred-relay")
        status="Relay settings saved."
    }
    func saveTrust() {
        guard verified, let host = try? Host(relay: relay, pin: pin), let data = try? JSONEncoder().encode(host) else {
            status = "Enter a valid relay address and check the computer fingerprint before saving."; return
        }
        do {
            if let record = imported {
                guard record.host == host else { status = "The entries do not match the connection file. Check them again."; return }
                try HostKeychain.write(record)
                hasSaved = true
            } else if trusted != host {
                hasSaved = try HostKeychain.read(host: host) != nil
            }
        } catch { status = "Could not save the host securely. Unlock your phone and try again."; return }
        trusted = host; UserDefaults.standard.set(host.relay,forKey:"preferred-relay"); UserDefaults.standard.set(data, forKey: trustKey); verified = false
        imported = nil; needsTrust = false
        status = hasSaved ? "This computer is saved. You can reconnect." : "Host fingerprint saved."
    }
    func loadInvitation(_ file: URL) {
        invitation = nil; imported = nil; needsTrust = false; hasInvitation = false; verified = false
        do {
            switch try ConnectionFile.load(file) {
            case .temporary(let room):
                invitation = room; hasInvitation = true; status = "Temporary invitation imported."
            case .persistent(let saved):
                imported = saved; needsTrust = true; relay = saved.host.relay; pin = saved.host.pin
                status = "Compare with the fingerprint shown separately on the computer, then save this host."
            }
        } catch { status = "The file is invalid or the temporary invitation has expired. Import it again." }
    }
    func forget() {
        do { try HostKeychain.forget(host: trusted) } catch { status = "Removal was not completed. Unlock your phone and try again."; return }
        UserDefaults.standard.removeObject(forKey: trustKey)
        trusted = nil; imported = nil; invitation = nil; relay = UserDefaults.standard.string(forKey:"preferred-relay") ?? CMConnection.defaultRelay(); pin = ""
        hasSaved = false; needsTrust = false; verified = false; hasInvitation = false
        status = "Host forgotten."
    }
    func connect() {
        connect(openArchived: false)
    }
    private func connect(openArchived: Bool) {
        guard !connecting, !needsTrust, let host = trusted else {
            status = "Check and save this host first."; return
        }
        openArchivedAfterConnect = openArchived
        if let existing = devices.first(where: {$0.id == host.relay + "|" + host.pin}) {
            selectDevice(existing.id)
            if openArchivedAfterConnect {
                openArchivedAfterConnect = false
                existing.webView.evaluateJavaScript("window.dispatchEvent(new Event('cage-open-archives'))")
            }
            return
        }
        let item = invitation

        guard item != nil || hasSaved else { status = "Import a connection file or a valid temporary invitation."; return }
        if let item, (item.expiry ?? .distantPast) <= Date() { invitation = nil; hasInvitation = false; status = "The temporary invitation has expired. Reconnect or import a new invitation."; return }
        guard let directory = Bundle.main.url(forResource: "mobile-ui", withExtension: nil) else { status = "The app package is missing workbench resources."; return }
        invitation = nil; hasInvitation = false; connecting = true; generation += 1
        let attempt = generation
        status = "Verifying the computer and connecting…"
        linkQueue.async {
            let result = Result {
                if let item { return try CMConnection.connect(relay: host.relay, room: item.id, token: item.client_token, pin: host.pin, assets: directory.path) }
                guard let saved = try HostKeychain.read(host: host), saved.host == host else { throw InputError.unavailable }
                return try CMConnection.connectSaved(relay: host.relay, lookup: saved.lookup, pin: host.pin, assets: directory.path)
            }
            DispatchQueue.main.async {
                guard attempt == self.generation else {
                    if case .success(let old) = result { DispatchQueue.global().async { old.close() } }
                    return
                }
                self.connecting = false
                switch result {
                case .success(let session): self.status = ""; self.addDevice(session, host: host)
                case .failure(let error): self.status = error.localizedDescription
                }
            }
        }
    }
    func leaveWorkspace() {showingWorkspace = false}
    func openArchivedSessions() {
        if let device = selectedDevice {
            selectDevice(device.id)
            device.webView.evaluateJavaScript("window.dispatchEvent(new Event('cage-open-archives'))")
        } else {
            connect(openArchived: true)
        }
    }
    func selectDevice(_ id: String) {
        guard devices.contains(where: {$0.id == id}) else {return}
        selectedDeviceID = id; showingWorkspace = true
        session = selectedDevice?.connection
        publishDevices()
    }
    func nameDevice(_ id: String, _ value: String) {
        guard let index = devices.firstIndex(where: {$0.id == id}) else {return}
        let name = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !name.isEmpty, devices[index].name != name else {return}
        devices[index].name = String(name.prefix(120)); publishDevices()
    }
    private func addDevice(_ connection: CMConnection, host: Host) {
        let id = host.relay + "|" + host.pin
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .nonPersistent()
        config.allowsInlineMediaPlayback = true
        config.preferences.javaScriptCanOpenWindowsAutomatically = false
        config.applicationNameForUserAgent = "CageMobile/1"
        let delegate = WorkspaceNavigation(connection.launchURL)
        config.userContentController.add(DeviceWebBridge(model: self, id: id, origin: connection.launchURL), name: "cageDevices")
        config.userContentController.addUserScript(WKUserScript(source: deviceScript(id), injectionTime: .atDocumentStart, forMainFrameOnly: true))
        let web = WKWebView(frame: .zero, configuration: config)
        web.scrollView.contentInsetAdjustmentBehavior = .never
        web.navigationDelegate = delegate
        // WKWebView holds its navigation delegate weakly.
        navigationDelegates[id] = delegate
        devices.append(ConnectedDevice(id: id, name: "Connected computer", connection: connection, webView: web))
        selectDevice(id)
        var launch = connection.launchURL
        if openArchivedAfterConnect {
            var parts = URLComponents(url: launch, resolvingAgainstBaseURL: false)!
            parts.queryItems = (parts.queryItems ?? []) + [URLQueryItem(name: "page", value: "archived")]
            launch = parts.url!
            openArchivedAfterConnect = false
        }
        web.load(URLRequest(url: launch))
    }
    private var navigationDelegates: [String: WKNavigationDelegate] = [:]
    private func deviceScript(_ current: String) -> String {
        let value: [String: Any] = ["current": current, "devices": devices.map {["id": $0.id, "name": $0.name]}]
        let data = try! JSONSerialization.data(withJSONObject: value, options: [.sortedKeys])
        return "window.__cageDevices=" + String(decoding: data, as: UTF8.self) + ";window.dispatchEvent(new CustomEvent('cage-devices',{detail:window.__cageDevices}));"
    }
    func publishDevices() {
        for device in devices {
            let script = deviceScript(device.id)
            device.webView.configuration.userContentController.removeAllUserScripts()
            device.webView.configuration.userContentController.addUserScript(WKUserScript(source: script, injectionTime: .atDocumentStart, forMainFrameOnly: true))
            // The preview fixture is installed separately and must survive navigation/reloads.
            #if targetEnvironment(simulator)
            if device.connection == nil {
                device.webView.configuration.userContentController.addUserScript(WKUserScript(source: SimulatorWorkspacePreview.fixture, injectionTime: .atDocumentStart, forMainFrameOnly: true))
            }
            #endif
            device.webView.evaluateJavaScript(script)
        }
    }
    func disconnectDevice(_ id: String) {
        guard let old = devices.first(where: {$0.id == id}) else {return}
        old.webView.stopLoading(); old.webView.navigationDelegate = nil
        old.webView.configuration.userContentController.removeScriptMessageHandler(forName: "cageDevices")
        devices.removeAll {$0.id == id}; navigationDelegates.removeValue(forKey: id)
        if selectedDeviceID == id {
            selectedDeviceID = devices.first?.id; session = selectedDevice?.connection
            if selectedDeviceID == nil {showingWorkspace = false}
        }
        if let connection = old.connection {linkQueue.async {connection.close()}}
        publishDevices()
    }
    func disconnect() {if let id = selectedDeviceID {disconnectDevice(id)}}
    func reconnect() {disconnect(); connect()}
    func startPreview() {
        #if targetEnvironment(simulator)
        for (id, name) in [("preview-mac", "My computer (simulator preview)"), ("preview-linux", "Linux workstation (simulator preview)")] {
            if !devices.contains(where: {$0.id == id}) {
                let preview = SimulatorWorkspacePreview.makeWebView(model: self, id: id)
                devices.append(ConnectedDevice(id: id, name: name, connection: nil, webView: preview.web))
                navigationDelegates[id] = preview.delegate
            }
        }
        selectDevice("preview-mac")
        #endif
    }
}

private final class WorkspaceNavigation: NSObject, WKNavigationDelegate {
    let origin: URL
    init(_ origin: URL) {self.origin = origin}
    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = action.request.url, action.targetFrame?.isMainFrame == true,
              url.scheme == origin.scheme, url.host == origin.host, url.port == origin.port,
              url.user == nil, url.password == nil else {decisionHandler(.cancel); return}
        decisionHandler(.allow)
    }
}

private struct Workspace: UIViewRepresentable {
    let webView: WKWebView
    func makeUIView(context: Context) -> WKWebView {webView}
    func updateUIView(_ view: WKWebView, context: Context) {}
}

private enum CageStyle {
    static let paper = Color(uiColor: UIColor { traits in
        traits.userInterfaceStyle == .dark ? UIColor(white: 0.075, alpha: 1) : UIColor(red: 0.982, green: 0.978, blue: 0.967, alpha: 1)
    })
    static let ink = Color(uiColor: .label)
    static let inverse = Color(uiColor: .systemBackground)
}

private struct CageButtonStyle: ButtonStyle {
    @Environment(\.isEnabled) private var enabled
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .opacity(enabled ? (configuration.isPressed ? 0.9 : 1) : 0.5)
    }
}

private struct ActionLabel: View {
    let title: String
    let symbol: String
    var primary = true
    var height: CGFloat = 52
    var body: some View {
        Label(title, systemImage: symbol)
            .font(.headline).frame(maxWidth: .infinity, minHeight: height)
            .foregroundStyle(primary ? CageStyle.inverse : CageStyle.ink)
            .background(primary ? CageStyle.ink : Color(uiColor: .secondarySystemFill),
                        in: RoundedRectangle(cornerRadius: 16))
            .contentShape(Rectangle())
    }
}

private struct QRScanner: UIViewControllerRepresentable {
    let region: CGRect
    @Binding var hint: String
    let result: (String?) -> Void
    final class Delegate: NSObject, DataScannerViewControllerDelegate {
        let result: (String?) -> Void
        var hint: Binding<String>
        var finished = false
        init(_ result: @escaping (String?) -> Void, hint: Binding<String>) {self.result = result; self.hint = hint}
        func dataScanner(_ scanner: DataScannerViewController, didAdd items: [RecognizedItem], allItems: [RecognizedItem]) {
            for case .barcode(let barcode) in items {
                guard !finished, let code = barcode.payloadStringValue else {continue}
                guard code.hasPrefix("CAGE1:"), code.utf8.count <= 4096 else {
                    hint.wrappedValue = "Scan the Cage pairing QR code in \"Settings → Remote connection\" on your computer"; continue
                }
                UINotificationFeedbackGenerator().notificationOccurred(.success)
                finished = true; scanner.stopScanning(); result(code); return
            }
        }
        func dataScanner(_ scanner: DataScannerViewController, becameUnavailableWithError error: DataScannerViewController.ScanningUnavailable) {
            if !finished {finished = true; result(nil)}
        }
    }
    func makeCoordinator() -> Delegate { Delegate(result, hint: $hint) }
    func makeUIViewController(context: Context) -> DataScannerViewController {
        let scanner = DataScannerViewController(recognizedDataTypes: [.barcode(symbologies: [.qr])], qualityLevel: .balanced, isGuidanceEnabled: false, isHighlightingEnabled: false)
        scanner.delegate = context.coordinator
        DispatchQueue.main.async {
            guard !context.coordinator.finished else {return}
            scanner.regionOfInterest = region
            do { try scanner.startScanning() } catch {context.coordinator.finished = true; result(nil)}
        }
        return scanner
    }
    func updateUIViewController(_ scanner: DataScannerViewController, context: Context) {scanner.regionOfInterest = region}
    static func dismantleUIViewController(_ scanner: DataScannerViewController, coordinator: Delegate) {coordinator.finished = true; scanner.stopScanning()}
}

private struct FinderMask: Shape {
    let box: CGRect
    func path(in rect: CGRect) -> Path {
        var path = Path(rect)
        path.addRoundedRect(in: box, cornerSize: CGSize(width: 18, height: 18))
        return path
    }
}
private struct FinderCorners: Shape {
    func path(in rect: CGRect) -> Path {
        var path = Path()
        for x in [CGFloat(0), CGFloat(1)] {for y in [CGFloat(0), CGFloat(1)] {
            var corner = Path()
            corner.move(to: CGPoint(x: 0, y: 30)); corner.addLine(to: CGPoint(x: 0, y: 18))
            corner.addQuadCurve(to: CGPoint(x: 18, y: 0), control: .zero); corner.addLine(to: CGPoint(x: 30, y: 0))
            let transform = CGAffineTransform(a: x == 0 ? 1 : -1, b: 0, c: 0, d: y == 0 ? 1 : -1, tx: x * rect.width, ty: y * rect.height)
            path.addPath(corner, transform: transform)
        }}
        return path
    }
}
private struct QRScannerScreen: View {
    let result: (String?) -> Void
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var sweeping = false
    @State private var hint = "Place the Cage pairing QR code in the frame\nGenerate it on your computer in \"Settings → Remote connection\""
    private let accent = Color(red: 0.91, green: 0.72, blue: 0.62)
    var body: some View {
        GeometryReader { geometry in
            let side = max(96, min(280, min(geometry.size.width - 56, geometry.size.height - 190)))
            let box = CGRect(x: (geometry.size.width - side) / 2, y: 24 + max(0, (geometry.size.height - 190 - side) / 2), width: side, height: side)
            ZStack(alignment: .bottom) {
                #if targetEnvironment(simulator)
                Color(white: 0.15)
                Image(systemName: "qrcode").resizable().interpolation(.none).scaledToFit()
                    .foregroundStyle(.white.opacity(0.8)).frame(width: side * 0.65, height: side * 0.65)
                    .position(x: box.midX, y: box.midY).accessibilityHidden(true)
                #else
                QRScanner(region: box, hint: $hint, result: result)
                #endif
                FinderMask(box: box).fill(Color(red: 0.08, green: 0.09, blue: 0.09).opacity(0.72), style: FillStyle(eoFill: true))
                RoundedRectangle(cornerRadius: 18).stroke(.white.opacity(0.45), lineWidth: 1)
                    .frame(width: side, height: side).position(x: box.midX, y: box.midY)
                FinderCorners().stroke(accent, style: StrokeStyle(lineWidth: 4, lineCap: .round))
                    .frame(width: side, height: side).position(x: box.midX, y: box.midY)
                VStack(spacing: 0) {
                    LinearGradient(colors: [accent.opacity(0), accent.opacity(0.22)], startPoint: .top, endPoint: .bottom).frame(height: 26)
                    Capsule().fill(accent).frame(height: 2)
                }.frame(width: side - 24)
                    .position(x: box.midX, y: reduceMotion ? box.midY : box.minY + 24 + (sweeping ? side - 48 : 0))
                    .animation(reduceMotion ? nil : .linear(duration: 2.4).repeatForever(autoreverses: true), value: sweeping)
                    .accessibilityHidden(true)
                VStack(spacing: 12) {
                    Text("Connect your computer").font(.title2.bold())
                    Text(hint).font(.subheadline).foregroundStyle(.white.opacity(0.88)).multilineTextAlignment(.center)
                    Text(simulatorPreviewEnabled ? "Simulator preview: opening the sample workbench soon" : "Cage pairing codes only")
                        .font(.caption).foregroundStyle(.white.opacity(0.6))
                }.foregroundStyle(.white).padding(.horizontal, 24).padding(.bottom, 24).accessibilityElement(children: .combine)
            }.background(Color.black).onAppear {sweeping = true}
                .task {
                    #if targetEnvironment(simulator)
                    do {try await Task.sleep(for: .seconds(2))} catch {return}
                    result(nil)
                    #endif
                }
        }.toolbarColorScheme(.dark, for: .navigationBar)
            .toolbarBackground(Color(red: 0.08, green: 0.09, blue: 0.09), for: .navigationBar).toolbarBackground(.visible, for: .navigationBar)
    }
}

private struct ConnectionSheet: View {
    @ObservedObject var model: ConnectionModel
    let previewConnected: () -> Void
    @State private var manual = false
    @State private var scanning = false
    @State private var disconnecting: ConnectedDevice?
    @State private var previewScanned = false
    @State private var code = ""
    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 12) {
                    Image("PairDevices").resizable().scaledToFit().frame(maxWidth: .infinity)
                        .frame(height: 150).accessibilityHidden(true)
                    Text("Connect computer").font(.title.bold())
                    Text("On your computer, open \"Remote connection\" in Cage settings and generate a pairing QR code or copy a pairing code.")
                        .font(.subheadline).foregroundStyle(.secondary).multilineTextAlignment(.center)
                        .padding(.bottom, 10)
                    Button {
                        Task { @MainActor in
                            if simulatorPreviewEnabled {scanning = true; return}
                            guard DataScannerViewController.isSupported,
                                  await AVCaptureDevice.requestAccess(for: .video),
                                  DataScannerViewController.isAvailable else {
                                model.status = "The camera is unavailable. Check camera permission or use a pairing code."; return
                            }
                            scanning = true
                        }
                    } label: {ActionLabel(title: "Scan QR code", symbol: "qrcode.viewfinder")}
                    Button {manual = true} label: {ActionLabel(title: "Use pairing code", symbol: "key", primary: false)}
                    if model.hasSaved || model.hasInvitation {
                        Button("Reconnect", action: model.connect).frame(minHeight: 44).disabled(!model.canConnect)
                    }
                    if !model.devices.isEmpty {
                        Divider().padding(.vertical, 8)
                        Text("Connected devices").font(.headline).frame(maxWidth: .infinity, alignment: .leading)
                        Text("Long-press a device to disconnect").font(.footnote).foregroundStyle(.secondary)
                            .frame(maxWidth: .infinity, alignment: .leading)
                        ForEach(model.devices) {device in
                            Button {if disconnecting == nil {model.selectDevice(device.id)}} label: {
                                HStack {Image(systemName: "desktopcomputer"); Text(device.name); Spacer(); Image(systemName: "chevron.right")}
                                    .frame(minHeight: 48).contentShape(Rectangle())
                            }
                            .simultaneousGesture(LongPressGesture().onEnded { _ in disconnecting = device })
                            .accessibilityAction(named: Text("Disconnect")) {disconnecting = device}
                        }
                    }
                    status
                }.padding(24).frame(maxWidth: 520)
                    .frame(maxWidth: .infinity)
            }.background(CageStyle.paper).buttonStyle(CageButtonStyle())
                .navigationDestination(isPresented: $manual) {
                    Form {
                        Section {
                            SecureField("Paste the one-time pairing code from your computer", text: $code)
                                .textInputAutocapitalization(.never).autocorrectionDisabled()
                            Button("Connect computer") {model.pair(code: code); code = ""}
                                .accessibilityIdentifier("redeem-pair-code")
                                .disabled(code.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || model.connecting)
                        }
                        if !model.status.isEmpty {Section {status}}
                    }.navigationTitle("Pairing code")
                }
                .sheet(item: $disconnecting) {device in
                    VStack(spacing: 20) {
                        Text("Disconnect?").font(.title2.bold())
                        Text(device.name).foregroundStyle(.secondary)
                        Text("This closes the connection for this device. Saved pairing information is kept.")
                            .font(.subheadline).foregroundStyle(.secondary).multilineTextAlignment(.center)
                        Button("Disconnect", role: .destructive) {
                            model.disconnectDevice(device.id)
                            disconnecting = nil
                        }.frame(maxWidth: .infinity, minHeight: 48)
                        Button("Stay connected") {disconnecting = nil}.frame(minHeight: 44)
                    }.padding(24).presentationDetents([.height(300)]).presentationDragIndicator(.visible)
                }
                .sheet(isPresented: $scanning, onDismiss: {
                    if previewScanned {previewScanned = false; previewConnected()}
                }) {
                    NavigationStack {
                        QRScannerScreen { result in
                            scanning = false
                            if simulatorPreviewEnabled {previewScanned = true}
                            else if let result {model.pair(code: result)}
                            else {model.status = "Could not read the QR code. Try again or use a pairing code."}
                        }.navigationTitle("Scan computer QR code").navigationBarTitleDisplayMode(.inline)
                        .toolbar {Button("Cancel") {scanning = false}}
                    }
                }
        }.disabled(model.connecting).interactiveDismissDisabled(model.connecting)
            .presentationDetents([.fraction(0.72), .large]).presentationDragIndicator(.visible)
    }
    @ViewBuilder private var status: some View {
        if !model.status.isEmpty {
            Text(model.status).font(.footnote).foregroundStyle(.secondary)
                .accessibilityAddTraits(.updatesFrequently)
        }
    }
}

private enum CageTheme: String, CaseIterable {
    case system = "Follow system", light = "Light", dark = "Dark"
    var scheme: ColorScheme? {
        switch self {case .system: return nil; case .light: return .light; case .dark: return .dark}
    }
}

private struct SettingsScreen: View {
    @ObservedObject var model: ConnectionModel
    @Binding var theme: CageTheme
    let connect: () -> Void
    @State private var relaySettings = false
    @State private var advanced = false
    @State private var themes = false
    @State private var picking = false
    @State private var confirmingForget = false

    var body: some View {
        Form {
            Section("Appearance") {
                DisclosureGroup(isExpanded: $themes) {
                    ForEach(CageTheme.allCases, id: \.self) {option in
                        Button {
                            theme = option; themes = false
                        } label: {
                            HStack {Text(option.rawValue); Spacer(); if theme == option {Image(systemName: "checkmark")}}
                                .frame(minHeight: 44).contentShape(Rectangle())
                        }.accessibilityAddTraits(theme == option ? .isSelected : [])
                    }
                } label: {
                    HStack {
                        Label("Theme", systemImage: "circle.lefthalf.filled")
                        Spacer(); Text(theme.rawValue).foregroundStyle(.secondary)
                    }
                }
            }
            Section("Computer connection") {
                Button("Archived sessions", action: model.openArchivedSessions)
                    .disabled(model.selectedDevice == nil && !model.canConnect)
                DisclosureGroup("Relay settings", isExpanded: $relaySettings) {
                    Toggle("Use a self-hosted relay", isOn: Binding(get: {model.relay != CMConnection.defaultRelay()},
                                                     set: {model.relay = $0 ? "" : CMConnection.defaultRelay()}))
                    if model.relay != CMConnection.defaultRelay() {
                        TextField("HTTPS address of your own VPS", text: $model.relay)
                            .keyboardType(.URL).textInputAutocapitalization(.never).autocorrectionDisabled()
                    } else {Text("Official Cage relay").foregroundStyle(.secondary)}
                    Button("Save relay settings", action: model.saveRelay)
                }
                DisclosureGroup("Fingerprint and connection file", isExpanded: $advanced) {
                    Text(CMConnection.usesSimulatorIdentity ? "Simulator test identity fingerprint" : "This phone's fingerprint").font(.headline)
                    Text(model.fingerprint).font(.caption.monospaced()).textSelection(.enabled)
                    Button("Copy phone fingerprint") {UIPasteboard.general.string = model.fingerprint; model.status = "Phone fingerprint copied"}
                        .disabled(model.fingerprint.isEmpty)
                    Button("Import connection file") {picking = true}
                    TextField("Computer fingerprint sha256:…", text: $model.pin).textInputAutocapitalization(.never).autocorrectionDisabled()
                    Toggle("Computer fingerprint checked", isOn: $model.verified)
                    Button("Save checked host", action: model.saveTrust).disabled(!model.verified)
                    if model.hasInvitation || model.hasSaved {Button("Connect to workbench", action: connect).disabled(!model.canConnect)}
                }
                if model.canForget {Button("Forget host", role: .destructive) {confirmingForget = true}}
            }
            if !model.status.isEmpty {Section {Text(model.status).font(.footnote).foregroundStyle(.secondary)}}
        }.navigationTitle("Settings").disabled(model.connecting)
            .alert("Forget host?", isPresented: $confirmingForget) {
                Button("Cancel", role: .cancel) {}
                Button("Forget host", role: .destructive, action: model.forget)
            } message: {Text("This removes this computer's address, fingerprint, and reconnect credentials.")}
            .fileImporter(isPresented: $picking, allowedContentTypes: [.json, .plainText]) {result in
                if case .success(let file) = result {model.loadInvitation(file)}
            }
    }
}

@main
struct CageMobileApp: App {
    @StateObject private var model = ConnectionModel()
    @AppStorage("appearance-theme") private var theme = CageTheme.system
    @State private var showingSettings = false
    @State private var pairing = false

    var body: some Scene {
        WindowGroup {
            NavigationStack {
                Group {
                    if model.showingWorkspace, let device = model.selectedDevice {
                        Workspace(webView: device.webView).id(device.id)
                    } else {
                        home
                    }
                }
                .navigationDestination(isPresented: $showingSettings) {
                    SettingsScreen(model: model, theme: $theme, connect: model.connect)
                }
            }.buttonStyle(CageButtonStyle()).tint(CageStyle.ink).preferredColorScheme(theme.scheme)
                .sheet(isPresented: $pairing) {
                    ConnectionSheet(model: model, previewConnected: {
                        pairing = false; showingSettings = false; model.startPreview()
                    }).buttonStyle(CageButtonStyle()).tint(CageStyle.ink).preferredColorScheme(theme.scheme)
                }
                .onChange(of: model.showingWorkspace) { _, connected in
                    if connected {pairing = false; showingSettings = false}
                }
                .onChange(of: model.relay) {model.verified = false}
                .onChange(of: model.pin) {model.verified = false}
        }
    }
    private var home: some View {
        GeometryReader { geometry in
            let brandSpacing = min(60, max(28, geometry.size.height * 0.075)) + 32
            ScrollView {
                VStack(spacing: 0) {
                    Spacer(minLength: 12)
                    VStack(spacing: brandSpacing) {
                        VStack(spacing: 12) {
                            Image("CageMark").resizable().scaledToFit().frame(width: 120, height: 120)
                                .clipShape(RoundedRectangle(cornerRadius: 16)).accessibilityHidden(true)
                            Text("Cage").font(.system(size: 36, weight: .semibold, design: .rounded))
                        }
                        Button {pairing = true} label: {
                            ActionLabel(title: "Connect computer", symbol: "desktopcomputer", height: 60)
                        }
                    }.frame(maxWidth: 276).padding(.top, 32)
                    Spacer(minLength: 12)
                }.padding(.horizontal, 24).frame(maxWidth: .infinity).frame(minHeight: geometry.size.height)
            }.scrollBounceBehavior(.basedOnSize)
        }.background(CageStyle.paper.ignoresSafeArea()).buttonStyle(CageButtonStyle())
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button {showingSettings = true} label: {Image(systemName: "gearshape")}
                        .accessibilityLabel("Settings")
                }
            }
    }
}
