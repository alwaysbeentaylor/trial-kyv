/**
 * Email Notification Service using Resend
 * Sends notifications when research is completed
 */

const { Resend } = require('resend');

class EmailService {
    constructor() {
        this.resend = null;
        this.notificationEmail = process.env.NOTIFICATION_EMAIL || 'Develop.json@gmail.com';
        this.fromEmail = process.env.FROM_EMAIL || 'KYV Research <noreply@knowyourvip.com>';
    }

    initialize() {
        if (!process.env.RESEND_API_KEY) {
            console.warn('⚠️ RESEND_API_KEY not set - Email notifications disabled');
            return false;
        }

        this.resend = new Resend(process.env.RESEND_API_KEY);
        console.log(`📧 Email notifications enabled → ${this.notificationEmail}`);
        return true;
    }

    isEnabled() {
        return Boolean(this.resend);
    }

    /**
     * Send notification for a single completed research
     */
    async notifySingleResearch(guest, research) {
        if (!this.resend) return;

        try {
            const vipScore = research.vip_score || 5;
            const vipEmoji = vipScore >= 8 ? '🌟' : vipScore >= 6 ? '⭐' : '👤';

            const fullReport = research.full_report ? JSON.parse(research.full_report) : null;
            const summary = fullReport?.executive_summary || research.notable_info || 'Geen samenvatting beschikbaar';

            await this.resend.emails.send({
                from: this.fromEmail,
                to: this.notificationEmail,
                subject: `${vipEmoji} Research Voltooid: ${guest.full_name} (VIP ${vipScore}/10)`,
                html: `
                    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                        <h2 style="color: #1a1a2e;">🔍 Research Rapport</h2>
                        
                        <div style="background: #f8f9fa; padding: 20px; border-radius: 8px; margin: 20px 0;">
                            <h3 style="margin-top: 0; color: #333;">${guest.full_name}</h3>
                            <p style="margin: 5px 0;"><strong>VIP Score:</strong> ${vipScore}/10 ${vipEmoji}</p>
                            <p style="margin: 5px 0;"><strong>Functie:</strong> ${research.job_title || 'Onbekend'}</p>
                            <p style="margin: 5px 0;"><strong>Bedrijf:</strong> ${research.company_name || guest.company || 'Onbekend'}</p>
                            <p style="margin: 5px 0;"><strong>Land:</strong> ${guest.country || 'Onbekend'}</p>
                            ${research.linkedin_url ? `<p style="margin: 5px 0;"><strong>LinkedIn:</strong> <a href="${research.linkedin_url}">${research.linkedin_url}</a></p>` : ''}
                        </div>

                        <div style="background: #eef2ff; padding: 20px; border-radius: 8px; margin: 20px 0;">
                            <h4 style="margin-top: 0; color: #4338ca;">📋 Samenvatting</h4>
                            <p style="color: #333; line-height: 1.6;">${summary}</p>
                        </div>

                        <p style="color: #666; font-size: 12px; margin-top: 30px;">
                            Dit bericht is automatisch verzonden door Know Your VIP.
                        </p>
                    </div>
                `
            });

            console.log(`📧 Email sent: Research completed for ${guest.full_name}`);
        } catch (error) {
            console.error('📧 Email error:', error.message);
        }
    }

    /**
     * Send notification for a completed batch/queue research
     */
    async notifyBatchComplete(queueId, results) {
        if (!this.resend) return;

        try {
            const { completed, total, errors, guests } = results;

            // Build guest summary list
            let guestList = '';
            if (guests && guests.length > 0) {
                const topGuests = guests
                    .sort((a, b) => (b.vip_score || 0) - (a.vip_score || 0))
                    .slice(0, 10);

                guestList = topGuests.map(g => {
                    const vipEmoji = g.vip_score >= 8 ? '🌟' : g.vip_score >= 6 ? '⭐' : '👤';
                    return `<tr>
                        <td style="padding: 8px; border-bottom: 1px solid #eee;">${g.full_name}</td>
                        <td style="padding: 8px; border-bottom: 1px solid #eee;">${vipEmoji} ${g.vip_score || '-'}/10</td>
                        <td style="padding: 8px; border-bottom: 1px solid #eee;">${g.job_title || '-'}</td>
                        <td style="padding: 8px; border-bottom: 1px solid #eee;">${g.company_name || '-'}</td>
                    </tr>`;
                }).join('');
            }

            const errorList = errors && errors.length > 0
                ? `<div style="background: #fee2e2; padding: 15px; border-radius: 8px; margin: 20px 0;">
                    <h4 style="margin-top: 0; color: #dc2626;">⚠️ Fouten (${errors.length})</h4>
                    <ul style="margin: 0; padding-left: 20px;">
                        ${errors.slice(0, 5).map(e => `<li>${e.guestId}: ${e.error}</li>`).join('')}
                        ${errors.length > 5 ? `<li>... en ${errors.length - 5} meer</li>` : ''}
                    </ul>
                   </div>`
                : '';

            await this.resend.emails.send({
                from: this.fromEmail,
                to: this.notificationEmail,
                subject: `✅ Batch Research Voltooid: ${completed}/${total} gasten`,
                html: `
                    <div style="font-family: Arial, sans-serif; max-width: 700px; margin: 0 auto;">
                        <h2 style="color: #1a1a2e;">📊 Batch Research Rapport</h2>
                        
                        <div style="background: #f0fdf4; padding: 20px; border-radius: 8px; margin: 20px 0;">
                            <h3 style="margin-top: 0; color: #166534;">Queue: ${queueId}</h3>
                            <p style="margin: 5px 0;"><strong>Voltooid:</strong> ${completed}/${total} gasten</p>
                            <p style="margin: 5px 0;"><strong>Fouten:</strong> ${errors?.length || 0}</p>
                        </div>

                        ${guestList ? `
                        <div style="margin: 20px 0;">
                            <h4 style="color: #333;">🔝 Top VIP Gasten</h4>
                            <table style="width: 100%; border-collapse: collapse;">
                                <thead>
                                    <tr style="background: #f1f5f9;">
                                        <th style="padding: 10px; text-align: left;">Naam</th>
                                        <th style="padding: 10px; text-align: left;">VIP</th>
                                        <th style="padding: 10px; text-align: left;">Functie</th>
                                        <th style="padding: 10px; text-align: left;">Bedrijf</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    ${guestList}
                                </tbody>
                            </table>
                            ${guests.length > 10 ? `<p style="color: #666; font-size: 12px;">... en ${guests.length - 10} meer gasten</p>` : ''}
                        </div>
                        ` : ''}

                        ${errorList}

                        <p style="color: #666; font-size: 12px; margin-top: 30px;">
                            Dit bericht is automatisch verzonden door Know Your VIP.
                        </p>
                    </div>
                `
            });

            console.log(`📧 Email sent: Batch ${queueId} completed (${completed}/${total})`);
        } catch (error) {
            console.error('📧 Batch email error:', error.message);
        }
    }
}

module.exports = new EmailService();
