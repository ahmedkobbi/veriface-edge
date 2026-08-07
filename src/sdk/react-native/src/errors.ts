/**
 * VeriFace React Native — Error class
 * Mirrors the web SDK VeriFaceError.
 */

import type { VeriFaceErrorCode } from './types'

export class VeriFaceError extends Error {
  code: VeriFaceErrorCode

  constructor(code: VeriFaceErrorCode, message: string) {
    super(message)
    this.code = code
    this.name = 'VeriFaceError'
  }

  toString(): string {
    return `VeriFaceError[${this.code}]: ${this.message}`
  }
}
