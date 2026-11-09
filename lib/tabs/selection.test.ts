import { describe, expect, it } from "bun:test"
import { BULK_CLOSE_CONFIRM_THRESHOLD, bulkCloseNeedsConfirm } from "./selection"

describe("bulkCloseNeedsConfirm", () => {
  it("closes small selections immediately", () => {
    expect(bulkCloseNeedsConfirm(1)).toBe(false)
    expect(bulkCloseNeedsConfirm(BULK_CLOSE_CONFIRM_THRESHOLD - 1)).toBe(false)
  })

  it("asks to confirm at the threshold and above", () => {
    expect(bulkCloseNeedsConfirm(BULK_CLOSE_CONFIRM_THRESHOLD)).toBe(true)
    expect(bulkCloseNeedsConfirm(BULK_CLOSE_CONFIRM_THRESHOLD + 1)).toBe(true)
    expect(bulkCloseNeedsConfirm(250)).toBe(true)
  })

  it("uses a threshold of 10", () => {
    expect(BULK_CLOSE_CONFIRM_THRESHOLD).toBe(10)
  })
})
