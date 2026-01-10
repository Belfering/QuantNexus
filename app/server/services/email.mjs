// server/services/email.mjs
// Email service using Resend

import { Resend } from 'resend'

// TEMPORARY: Hardcoded key to bypass Railway env var issue
// TODO: Remove this and use process.env.RESEND_API_KEY once Railway issue is resolved
const RESEND_KEY = process.env.RESEND_API_KEY || 're_VBRvt4NP_CuUxgyzQ6QWZDycNz5AgeqDd'
const resend = new Resend(RESEND_KEY)

// Use verified domain or Resend's test domain
// To use your own domain: verify it at https://resend.com/domains
const FROM_EMAIL = process.env.EMAIL_FROM || 'Atlas Engine <onboarding@resend.dev>'

/**
 * Send email verification link
 */
export async function sendVerificationEmail(email, token) {
  const verifyUrl = `${process.env.APP_URL || 'https://www.quantnexus.io'}/verify-email?token=${token}`

  try {
    const { data, error } = await resend.emails.send({
      from: FROM_EMAIL,
      to: email,
      subject: 'Verify your Atlas Engine account',
      html: `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
          <h1 style="color: #1a1a2e;">Welcome to Atlas Engine</h1>
          <p>Thanks for signing up! Please verify your email address by clicking the button below:</p>
          <a href="${verifyUrl}" style="display: inline-block; background: #4f46e5; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; margin: 16px 0;">
            Verify Email
          </a>
          <p style="color: #666; font-size: 14px;">Or copy this link: ${verifyUrl}</p>
          <p style="color: #666; font-size: 14px;">This link expires in 24 hours.</p>
          <hr style="border: none; border-top: 1px solid #eee; margin: 24px 0;">
          <p style="color: #999; font-size: 12px;">If you didn't create an account, you can ignore this email.</p>
        </div>
      `
    })

    if (error) {
      console.error('[email] Failed to send verification email:', error)
      return false
    }

    console.log(`[email] Verification email sent to ${email}, id: ${data?.id}`)
    return true
  } catch (err) {
    console.error('[email] Error sending verification email:', err)
    return false
  }
}

/**
 * Send password reset link
 */
export async function sendPasswordResetEmail(email, token) {
  const resetUrl = `${process.env.APP_URL || 'https://www.quantnexus.io'}/reset-password?token=${token}`

  try {
    const { data, error } = await resend.emails.send({
      from: FROM_EMAIL,
      to: email,
      subject: 'Reset your Atlas Engine password',
      html: `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
          <h1 style="color: #1a1a2e;">Password Reset Request</h1>
          <p>We received a request to reset your password. Click the button below to create a new password:</p>
          <a href="${resetUrl}" style="display: inline-block; background: #4f46e5; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; margin: 16px 0;">
            Reset Password
          </a>
          <p style="color: #666; font-size: 14px;">Or copy this link: ${resetUrl}</p>
          <p style="color: #666; font-size: 14px;">This link expires in 1 hour.</p>
          <hr style="border: none; border-top: 1px solid #eee; margin: 24px 0;">
          <p style="color: #999; font-size: 12px;">If you didn't request a password reset, you can ignore this email. Your password will remain unchanged.</p>
        </div>
      `
    })

    if (error) {
      console.error('[email] Failed to send password reset email:', error)
      return false
    }

    console.log(`[email] Password reset email sent to ${email}, id: ${data?.id}`)
    return true
  } catch (err) {
    console.error('[email] Error sending password reset email:', err)
    return false
  }
}
