import nodemailer, { Transporter } from "nodemailer";
import { config } from "../../config/env.js";

export interface SendOtpResult {
  sent: boolean;
  mode: "smtp" | "mock";
  code?: string;
  messageId?: string;
}

export class EmailService {
  private transporter: Transporter | null = null;

  constructor() {
    if (config.SMTP_USER && config.SMTP_PASS) {
      this.transporter = nodemailer.createTransport({
        host: config.SMTP_HOST || "smtp.gmail.com",
        port: config.SMTP_PORT || 465,
        secure: config.SMTP_PORT === 465,
        auth: {
          user: config.SMTP_USER,
          pass: config.SMTP_PASS,
        },
      });
    }
  }

  async sendOtpEmail(toEmail: string, code: string): Promise<SendOtpResult> {
    const htmlTemplate = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Vaultkern Verification Code</title>
      </head>
      <body style="margin: 0; padding: 0; background-color: #08080a; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #ffffff;">
        <table width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: #08080a; padding: 40px 20px;">
          <tr>
            <td align="center">
              <table width="100%" max-width="500" border="0" cellspacing="0" cellpadding="0" style="max-width: 500px; background-color: #12141a; border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 24px; padding: 40px 32px; text-align: center;">
                <!-- Logo -->
                <tr>
                  <td align="center" style="padding-bottom: 24px;">
                    <div style="display: inline-block; width: 44px; height: 44px; border-radius: 50%; background-color: #ffffff; color: #000000; font-weight: 900; font-size: 20px; line-height: 44px; text-align: center;">
                      R
                    </div>
                    <div style="font-size: 20px; font-weight: 800; letter-spacing: -0.5px; color: #ffffff; margin-top: 12px;">
                      Vaultkern
                    </div>
                  </td>
                </tr>

                <!-- Title -->
                <tr>
                  <td align="center" style="padding-bottom: 12px;">
                    <h1 style="font-size: 22px; font-weight: 700; color: #ffffff; margin: 0;">Confirm your Gmail sign-in</h1>
                  </td>
                </tr>

                <!-- Description -->
                <tr>
                  <td align="center" style="padding-bottom: 28px;">
                    <p style="font-size: 14px; line-height: 1.5; color: #94a3b8; margin: 0;">
                      Use the 6-digit verification code below to verify your Gmail account and access your high-concurrency ledger wallet.
                    </p>
                  </td>
                </tr>

                <!-- OTP Code Display -->
                <tr>
                  <td align="center" style="padding-bottom: 28px;">
                    <div style="display: inline-block; background: linear-gradient(135deg, rgba(255, 255, 255, 0.08) 0%, rgba(255, 255, 255, 0.03) 100%); border: 1px solid rgba(255, 255, 255, 0.2); border-radius: 16px; padding: 18px 32px;">
                      <span style="font-family: 'JetBrains Mono', Courier, monospace; font-size: 34px; font-weight: 800; letter-spacing: 8px; color: #38bdf8;">
                        ${code}
                      </span>
                    </div>
                  </td>
                </tr>

                <!-- Expiry Note -->
                <tr>
                  <td align="center" style="padding-bottom: 32px;">
                    <p style="font-size: 13px; color: #64748b; margin: 0;">
                      ⏱️ This code expires in <strong style="color: #cbd5e1;">5 minutes</strong>. Never share this code with anyone.
                    </p>
                  </td>
                </tr>

                <!-- Divider -->
                <tr>
                  <td style="border-top: 1px solid rgba(255, 255, 255, 0.08); padding-top: 24px;" align="center">
                    <p style="font-size: 11px; line-height: 1.4; color: #475569; margin: 0;">
                      Vaultkern Ledger Engine • Strict Double-Entry Financial Core<br/>
                      Zero race conditions • Zero overdrafts • Pessimistic row locking
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </body>
      </html>
    `;

    // 1. Live SMTP Mode (if credentials provided)
    if (this.transporter) {
      try {
        const info = await this.transporter.sendMail({
          from: config.SMTP_FROM,
          to: toEmail,
          subject: `${code} is your Vaultkern verification code`,
          text: `Your Vaultkern Gmail verification code is: ${code}. It expires in 5 minutes.`,
          html: htmlTemplate,
        });

        console.log(`[EMAIL DISPATCHED] OTP sent via SMTP to ${toEmail} (ID: ${info.messageId})`);
        return {
          sent: true,
          mode: "smtp",
          messageId: info.messageId,
        };
      } catch (err: any) {
        console.error(`[SMTP ERROR] Failed to send email via SMTP: ${err.message}. Falling back to dev logger.`);
      }
    }

    // 2. Dev / Mock Mode (Console logger & frictionless local testing)
    console.log("==========================================================");
    console.log(`📧 [VAULTKERN GMAIL OTP SIMULATOR]`);
    console.log(`   Target Email : ${toEmail}`);
    console.log(`   Verification Code : ${code}`);
    console.log(`   Valid For    : 5 minutes (300 seconds)`);
    console.log("==========================================================");

    return {
      sent: true,
      mode: "mock",
      code,
    };
  }
}

export const emailService = new EmailService();
