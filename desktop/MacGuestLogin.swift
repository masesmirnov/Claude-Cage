import Cocoa
import Security

// The trial credential belongs to this local VM. It is never passed to the
// WebKit page, the control service, logs, command-line arguments or iCloud.
enum MacGuestLoginCredential {
    private static func item() throws -> [String: Any] {
        guard CageProfile.macGuestTrial else { throw CageUpdateError("This action only applies to the local macOS trial.") }
        struct Binding: Decodable { let machineID: String; let user: String }
        let url = CageProfile.configURL().deletingLastPathComponent().appendingPathComponent("macos-guest.json")
        let binding = try JSONDecoder().decode(Binding.self, from: Data(contentsOf: url))
        return [kSecClass as String: kSecClassGenericPassword,
                kSecAttrService as String: "io.github.lee-xeo.claude-cage.macos-trial.guest-login",
                kSecAttrAccount as String: binding.user + "@" + binding.machineID,
                kSecAttrSynchronizable as String: false]
    }
    static func importFromPipe() throws {
        guard isatty(STDIN_FILENO) == 0 else { throw CageUpdateError("Provide the trial guest credentials through a private pipe.") }
        let secret = FileHandle.standardInput.readData(ofLength: 1025)
        guard !secret.isEmpty, secret.count <= 1024 else { throw CageUpdateError("The guest credentials are empty or too long.") }
        var query = try item()
        query[kSecAttrLabel as String] = "Cage macOS trial guest sign-in"
        query[kSecValueData as String] = secret
        let status = SecItemAdd(query as CFDictionary, nil)
        if status == errSecDuplicateItem, try read() == secret { return }
        guard status == errSecSuccess else { throw CageUpdateError("Could not save the local trial guest credentials (\(status)).") }
    }
    private static func read() throws -> Data {
        var query = try item()
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var value: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &value)
        guard status == errSecSuccess, let data = value as? Data else { throw CageUpdateError("The local Keychain has no usable trial guest password.") }
        return data
    }
    static func copyForLogin() throws {
        guard let text = String(data: try read(), encoding: .utf8) else { throw CageUpdateError("The guest password format is invalid.") }
        let item = NSPasteboardItem()
        item.setString(text, forType: .string)
        item.setData(Data(), forType: .init("org.nspasteboard.ConcealedType"))
        item.setData(Data(), forType: .init("org.nspasteboard.TransientType"))
        let board = NSPasteboard.general
        board.clearContents()
        guard board.writeObjects([item]) else { throw CageUpdateError("Could not write to the clipboard.") }
        let change = board.changeCount
        DispatchQueue.main.asyncAfter(deadline: .now() + 60) {
            if board.changeCount == change { board.clearContents() }
        }
    }
}
