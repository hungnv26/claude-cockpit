// Reads Apple Silicon die temperatures without admin rights and prints one
// JSON line per interval: {"cpu":41.2,"max":44.0}. Uses the IOHID sensor
// services powermetrics itself reads; if Apple changes them this exits and
// the board simply shows no temperature.
import Foundation

@_silgen_name("IOHIDEventSystemClientCreate")
func IOHIDEventSystemClientCreate(_ allocator: CFAllocator?) -> Unmanaged<AnyObject>
@_silgen_name("IOHIDEventSystemClientSetMatching")
func IOHIDEventSystemClientSetMatching(_ client: AnyObject, _ match: CFDictionary) -> Int32
@_silgen_name("IOHIDEventSystemClientCopyServices")
func IOHIDEventSystemClientCopyServices(_ client: AnyObject) -> Unmanaged<CFArray>?
@_silgen_name("IOHIDServiceClientCopyEvent")
func IOHIDServiceClientCopyEvent(_ service: AnyObject, _ type: Int64, _ options: Int32, _ timestamp: Int64) -> Unmanaged<AnyObject>?
@_silgen_name("IOHIDServiceClientCopyProperty")
func IOHIDServiceClientCopyProperty(_ service: AnyObject, _ key: CFString) -> Unmanaged<CFTypeRef>?
@_silgen_name("IOHIDEventGetFloatValue")
func IOHIDEventGetFloatValue(_ event: AnyObject, _ field: Int32) -> Double

let kTemperature: Int64 = 15
let field = Int32(kTemperature << 16)
let client = IOHIDEventSystemClientCreate(kCFAllocatorDefault).takeRetainedValue()
// Apple vendor usage page 0xff00, usage 5 = temperature sensors.
_ = IOHIDEventSystemClientSetMatching(client, ["PrimaryUsagePage": 0xff00, "PrimaryUsage": 5] as CFDictionary)

func sample() -> (cpu: Double, max: Double)? {
  guard let services = IOHIDEventSystemClientCopyServices(client)?.takeRetainedValue() as? [AnyObject] else { return nil }
  var die: [Double] = []
  var all: [Double] = []
  for s in services {
    guard let ev = IOHIDServiceClientCopyEvent(s, kTemperature, 0, 0)?.takeRetainedValue() else { continue }
    let t = IOHIDEventGetFloatValue(ev, field)
    if t <= 0 || t > 130 { continue }
    all.append(t)
    let name = (IOHIDServiceClientCopyProperty(s, "Product" as CFString)?.takeRetainedValue() as? String) ?? ""
    if name.contains("tdie") { die.append(t) }
  }
  guard let hottest = all.max() else { return nil }
  let cpu = die.isEmpty ? hottest : die.reduce(0, +) / Double(die.count)
  return (cpu, hottest)
}

let interval = CommandLine.arguments.count > 1 ? (Double(CommandLine.arguments[1]) ?? 0) : 0
setvbuf(stdout, nil, _IOLBF, 0)
repeat {
  guard let r = sample() else { exit(1) }
  print(String(format: "{\"cpu\":%.1f,\"max\":%.1f}", r.cpu, r.max))
  if interval > 0 { Thread.sleep(forTimeInterval: interval) }
} while interval > 0
