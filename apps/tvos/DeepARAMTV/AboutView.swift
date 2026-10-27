import CoreImage.CIFilterBuiltins
import DeepARAMKit
import DeepARAMTVKit
import SwiftUI

/// What the app is, a code to open the full site on a phone, and Riot's notice.
struct AboutView: View {
    let data: TVData
    @EnvironmentObject private var store: TVStore

    var body: some View {
        ScrollView(.vertical) {
            VStack(alignment: .leading, spacing: 32) {
                Header(title: "DeepARAM", subtitle: "ARAM Mayhem tier lists, builds and PBE changes · Patch \(data.patch)")
                FocusBlock {
                    HStack(alignment: .center, spacing: 56) {
                        if let qr = Self.qrCode(Site.base.absoluteString) {
                            Image(decorative: qr, scale: 1)
                                .interpolation(.none)
                                .resizable()
                                .frame(width: 260, height: 260)
                                .padding(16)
                                .background(.white, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
                        }
                        VStack(alignment: .leading, spacing: 16) {
                            Text("More on your phone").font(.title3.bold())
                            Text("Scan the code or visit \(Site.host) for the Simulator, The Kitchen, champion details and your own stats.")
                                .foregroundStyle(.secondary)
                        }
                    }
                }
                HStack(spacing: 40) {
                    if let saved = store.savedCopyDate {
                        Text("Offline: showing the copy saved \(saved.formatted(date: .abbreviated, time: .shortened)).")
                    } else {
                        Text("Up to date with \(Site.host).")
                    }
                    Button("Refresh now") { Task { await store.refresh(force: true) } }
                }
                .foregroundStyle(.secondary)
                FocusBlock {
                    Text(Legal.riotNotice).font(.caption).foregroundStyle(.secondary)
                }
            }
            .padding(.bottom, 60)
        }
    }

    static func qrCode(_ text: String) -> CGImage? {
        let filter = CIFilter.qrCodeGenerator()
        filter.message = Data(text.utf8)
        filter.correctionLevel = "M"
        guard let out = filter.outputImage else { return nil }
        return CIContext().createCGImage(out, from: out.extent)
    }
}
