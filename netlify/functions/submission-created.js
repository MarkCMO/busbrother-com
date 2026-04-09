/**
 * Netlify submission-created event handler
 * Fires automatically when any Netlify Form receives a submission
 * Sends a formatted HTML email to the business owner via Resend
 */

const NOTIFY_EMAILS = (process.env.BUSBROTHER_NOTIFY_EMAIL || 'info@busbrother.com').split(',').map(e => e.trim());
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM_EMAIL = process.env.BUSBROTHER_FROM_EMAIL || 'onboarding@resend.dev';

exports.handler = async (event) => {
  try {
    const { payload } = JSON.parse(event.body);
    const formName = payload.form_name || 'Unknown Form';
    const data = payload.data || {};
    const submittedAt = new Date().toLocaleString('en-US', { timeZone: 'America/New_York' });

    // Build the data rows for the email
    const fields = Object.entries(data)
      .filter(([key]) => !['form-name', 'bot-field'].includes(key))
      .map(([key, value]) => {
        if (!value) return '';
        const label = key.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
        return `
          <tr>
            <td style="padding:10px 16px;font-weight:600;color:#f5a623;text-transform:uppercase;font-size:12px;letter-spacing:1px;border-bottom:1px solid #1e3052;width:160px;vertical-align:top;">${label}</td>
            <td style="padding:10px 16px;color:#f8f6f0;font-size:14px;border-bottom:1px solid #1e3052;">${String(value).replace(/</g, '&lt;').replace(/>/g, '&gt;')}</td>
          </tr>`;
      })
      .filter(Boolean)
      .join('');

    // Determine the type of lead
    let leadType = 'Quote Request';
    let emoji = '&#x1F68C;';
    if (formName === 'contact') { leadType = 'Contact Message'; emoji = '&#x2709;&#xFE0F;'; }
    if (formName === 'lead-magnet') { leadType = 'Lead Magnet Download'; emoji = '&#x1F4E9;'; }
    if (formName === 'lead-magnet-cruise') { leadType = 'Cruise Checklist Download'; emoji = '&#x1F6F3;&#xFE0F;'; }

    const subject = `[BusBrother] New ${leadType} from ${data.name || data.email || 'Website'}`;

    const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"/></head>
<body style="margin:0;padding:0;background:#060e1c;font-family:Arial,Helvetica,sans-serif;">
  <div style="max-width:600px;margin:0 auto;padding:20px;">
    <!-- Header -->
    <div style="background:#0a1628;border:1px solid #1e3052;border-radius:8px 8px 0 0;padding:24px;text-align:center;">
      <h1 style="margin:0;color:#f8f6f0;font-size:28px;letter-spacing:3px;">BUS<span style="color:#f5a623;">BROTHER</span></h1>
      <p style="color:#8a9ab5;font-size:12px;letter-spacing:2px;margin:8px 0 0;text-transform:uppercase;">New ${leadType}</p>
    </div>

    <!-- Body -->
    <div style="background:#111d33;border-left:1px solid #1e3052;border-right:1px solid #1e3052;padding:24px;">
      <div style="background:rgba(245,166,35,0.08);border:1px solid rgba(245,166,35,0.3);border-radius:6px;padding:16px;margin-bottom:20px;">
        <p style="margin:0;color:#f5a623;font-size:14px;font-weight:600;">${emoji} ${leadType} received at ${submittedAt} ET</p>
        ${data['page-url'] ? `<p style="margin:6px 0 0;color:#8a9ab5;font-size:12px;">From page: https://busbrother.com${data['page-url']}</p>` : ''}
      </div>

      <table style="width:100%;border-collapse:collapse;background:#0a1628;border:1px solid #1e3052;border-radius:6px;">
        ${fields}
      </table>
    </div>

    <!-- Actions -->
    <div style="background:#0a1628;border:1px solid #1e3052;border-radius:0 0 8px 8px;padding:24px;text-align:center;">
      ${data.email ? `<a href="mailto:${data.email}?subject=BusBrother%20Quote%20-%20${encodeURIComponent(data.name || '')}&body=Hi%20${encodeURIComponent(data.name || 'there')}%2C%0A%0AThank%20you%20for%20your%20interest%20in%20BusBrother!%0A%0A" style="display:inline-block;background:#f5a623;color:#060e1c;padding:12px 28px;border-radius:6px;text-decoration:none;font-weight:700;font-size:14px;margin-right:10px;">Reply to ${data.name || 'Customer'}</a>` : ''}
      ${data.phone ? `<a href="tel:${data.phone}" style="display:inline-block;background:transparent;border:1px solid #1e3052;color:#f8f6f0;padding:12px 28px;border-radius:6px;text-decoration:none;font-weight:600;font-size:14px;">Call ${data.phone}</a>` : ''}
      <p style="color:#8a9ab5;font-size:11px;margin-top:16px;">This notification was sent by BusBrother.com forms</p>
    </div>
  </div>
</body>
</html>`;

    // Send email via Resend if API key is configured
    if (RESEND_API_KEY) {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${RESEND_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          from: FROM_EMAIL,
          to: NOTIFY_EMAILS,
          subject: subject,
          html: html
        })
      });
      const result = await res.json();
      console.log('Email sent:', result);
    } else {
      console.log('RESEND_API_KEY not set - email not sent. Form data:', JSON.stringify(data));
    }

    return { statusCode: 200, body: 'OK' };
  } catch (err) {
    console.error('submission-created error:', err);
    return { statusCode: 200, body: 'OK' }; // Return 200 so Netlify doesn't retry
  }
};
