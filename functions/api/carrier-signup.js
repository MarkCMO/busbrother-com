// POST /api/carrier-signup
// New charter bus operator applies to join the BusBrother carrier network.
// Inserts row in bb_vendors (approved=false until Mark reviews), emails Mark.
// Founding-carrier status is granted only by Mark (manually via SQL or admin tool).

import { json, errResponse, optionsResponse, supabase, sendEmail } from '../_shared/helpers.js';

export async function onRequest({ request, env }) {
  if (request.method === 'OPTIONS') return optionsResponse();
  if (request.method !== 'POST') return errResponse('Method not allowed', 405);

  let data = {};
  const ct = request.headers.get('content-type') || '';
  try {
    if (ct.includes('application/json')) {
      data = await request.json();
    } else {
      const form = await request.formData();
      for (const [k, v] of form.entries()) data[k] = v;
    }
  } catch { return errResponse('Invalid request body'); }

  // Honeypot
  if (data['bot-field']) return json({ success: true });

  // Required fields
  const required = ['company_name', 'contact_name', 'email', 'phone', 'usdot_number', 'primary_service_area', 'fleet_summary'];
  for (const f of required) {
    if (!data[f] || String(data[f]).trim().length === 0) {
      return errResponse(`Missing required field: ${f}`, 400);
    }
  }

  // Normalize
  const email = String(data.email).trim().toLowerCase();
  const usdotNumber = String(data.usdot_number).replace(/\D/g, '');
  const mcNumber = data.mc_number ? String(data.mc_number).replace(/\D/g, '') : null;
  const insuranceAmount = data.insurance_amount ? parseFloat(String(data.insurance_amount).replace(/[$,]/g, '')) : null;

  // Insert
  const insertRes = await supabase(env, 'bb_vendors', 'POST', {
    company_name: data.company_name,
    contact_name: data.contact_name,
    email,
    phone: data.phone,
    usdot_number: usdotNumber || null,
    mc_number: mcNumber,
    insurance_amount: insuranceAmount,
    insurance_expires: data.insurance_expires || null,
    fleet_summary: data.fleet_summary,
    primary_service_area: data.primary_service_area,
    secondary_service_areas: data.secondary_service_areas || null,
    active: false,        // not active until Mark approves
    approved: false,
    founding_carrier: false
  });

  if (!insertRes.ok) {
    // Check if already exists
    if (insertRes.status === 409 || (insertRes.data && JSON.stringify(insertRes.data).includes('duplicate'))) {
      return errResponse('A carrier with that email is already registered. We will contact you with status.', 409);
    }
    return errResponse('We could not save your application. Please try again or email info@busbrother.com.', 500);
  }

  const vendorId = (insertRes.data && insertRes.data[0]) ? insertRes.data[0].id : null;
  const adminSecret = env.BUSBROTHER_ADMIN_SECRET;
  const approveUrl = vendorId && adminSecret
    ? `https://busbrother.com/api/jobs-admin?secret=${adminSecret}&resource=vendors&action=approve&vendor_id=${vendorId}`
    : null;
  const declineUrl = vendorId && adminSecret
    ? `https://busbrother.com/api/jobs-admin?secret=${adminSecret}&resource=vendors&action=delete&vendor_id=${vendorId}`
    : null;

  // Notify Mark
  const ownerHtml = `
<!DOCTYPE html><html><head><meta charset="utf-8"/></head>
<body style="margin:0;padding:0;background:#060e1c;font-family:Arial,Helvetica,sans-serif;">
<div style="max-width:600px;margin:0 auto;padding:20px;">
  <div style="background:#0a1628;border:1px solid #1e3052;border-radius:8px 8px 0 0;padding:24px;text-align:center;">
    <h1 style="margin:0;color:#f8f6f0;font-size:28px;letter-spacing:3px;">BUS<span style="color:#f5a623;">BROTHER</span></h1>
    <p style="color:#8a9ab5;font-size:12px;letter-spacing:2px;margin:8px 0 0;text-transform:uppercase;">New Carrier Application — Pending Review</p>
  </div>
  <div style="background:#111d33;border-left:1px solid #1e3052;border-right:1px solid #1e3052;padding:24px;">
    <div style="background:rgba(245,166,35,0.12);border:2px solid rgba(245,166,35,0.5);border-radius:6px;padding:16px;margin-bottom:20px;text-align:center;">
      <p style="margin:0;color:#f5a623;font-size:16px;font-weight:700;">VERIFY USDOT BEFORE APPROVING</p>
      <p style="margin:6px 0 0;color:#f8f6f0;font-size:13px;">Check FMCSA SAFER: safer.fmcsa.dot.gov</p>
    </div>
    <table style="width:100%;border-collapse:collapse;background:#0a1628;border:1px solid #1e3052;border-radius:6px;">
      <tr><td style="padding:10px 16px;color:#f5a623;font-size:12px;font-weight:600;text-transform:uppercase;border-bottom:1px solid #1e3052;width:160px;">Company</td><td style="padding:10px 16px;color:#f8f6f0;font-size:14px;border-bottom:1px solid #1e3052;">${data.company_name}</td></tr>
      <tr><td style="padding:10px 16px;color:#f5a623;font-size:12px;font-weight:600;text-transform:uppercase;border-bottom:1px solid #1e3052;">Contact</td><td style="padding:10px 16px;color:#f8f6f0;font-size:14px;border-bottom:1px solid #1e3052;">${data.contact_name} — ${email}</td></tr>
      <tr><td style="padding:10px 16px;color:#f5a623;font-size:12px;font-weight:600;text-transform:uppercase;border-bottom:1px solid #1e3052;">Phone</td><td style="padding:10px 16px;color:#f8f6f0;font-size:14px;border-bottom:1px solid #1e3052;">${data.phone}</td></tr>
      <tr><td style="padding:10px 16px;color:#f5a623;font-size:12px;font-weight:600;text-transform:uppercase;border-bottom:1px solid #1e3052;">USDOT #</td><td style="padding:10px 16px;color:#f8f6f0;font-size:14px;border-bottom:1px solid #1e3052;"><a href="https://safer.fmcsa.dot.gov/query.asp?searchtype=ANY&query_type=queryCarrierSnapshot&query_param=USDOT&query_string=${usdotNumber}" style="color:#f5a623;">${usdotNumber || 'NOT PROVIDED'}</a></td></tr>
      ${mcNumber ? `<tr><td style="padding:10px 16px;color:#f5a623;font-size:12px;font-weight:600;text-transform:uppercase;border-bottom:1px solid #1e3052;">MC #</td><td style="padding:10px 16px;color:#f8f6f0;font-size:14px;border-bottom:1px solid #1e3052;">${mcNumber}</td></tr>` : ''}
      ${insuranceAmount ? `<tr><td style="padding:10px 16px;color:#f5a623;font-size:12px;font-weight:600;text-transform:uppercase;border-bottom:1px solid #1e3052;">Insurance</td><td style="padding:10px 16px;color:${insuranceAmount >= 5000000 ? '#2ecc71' : '#e74c3c'};font-size:14px;border-bottom:1px solid #1e3052;">$${insuranceAmount.toLocaleString()} ${insuranceAmount < 5000000 ? '⚠ BELOW $5M MINIMUM' : '✓'}</td></tr>` : ''}
      ${data.insurance_expires ? `<tr><td style="padding:10px 16px;color:#f5a623;font-size:12px;font-weight:600;text-transform:uppercase;border-bottom:1px solid #1e3052;">Insurance Expires</td><td style="padding:10px 16px;color:#f8f6f0;font-size:14px;border-bottom:1px solid #1e3052;">${data.insurance_expires}</td></tr>` : ''}
      <tr><td style="padding:10px 16px;color:#f5a623;font-size:12px;font-weight:600;text-transform:uppercase;border-bottom:1px solid #1e3052;">Primary Service Area</td><td style="padding:10px 16px;color:#f8f6f0;font-size:14px;border-bottom:1px solid #1e3052;">${data.primary_service_area}</td></tr>
      ${data.secondary_service_areas ? `<tr><td style="padding:10px 16px;color:#f5a623;font-size:12px;font-weight:600;text-transform:uppercase;border-bottom:1px solid #1e3052;">Secondary Areas</td><td style="padding:10px 16px;color:#f8f6f0;font-size:14px;border-bottom:1px solid #1e3052;">${data.secondary_service_areas}</td></tr>` : ''}
      <tr><td style="padding:10px 16px;color:#f5a623;font-size:12px;font-weight:600;text-transform:uppercase;border-bottom:1px solid #1e3052;vertical-align:top;">Fleet</td><td style="padding:10px 16px;color:#f8f6f0;font-size:14px;border-bottom:1px solid #1e3052;">${String(data.fleet_summary).replace(/\n/g, '<br/>')}</td></tr>
      ${data.notes ? `<tr><td style="padding:10px 16px;color:#f5a623;font-size:12px;font-weight:600;text-transform:uppercase;border-bottom:1px solid #1e3052;vertical-align:top;">Notes</td><td style="padding:10px 16px;color:#f8f6f0;font-size:14px;border-bottom:1px solid #1e3052;">${String(data.notes).replace(/\n/g, '<br/>')}</td></tr>` : ''}
    </table>
  </div>
  <div style="background:#0a1628;border:1px solid #1e3052;border-radius:0 0 8px 8px;padding:24px;text-align:center;">
    ${approveUrl ? `<a href="${approveUrl}" style="display:inline-block;background:#2ecc71;color:#fff;padding:14px 32px;border-radius:6px;text-decoration:none;font-weight:700;font-size:15px;margin-right:8px;">Approve Carrier</a>
    <a href="${declineUrl}" style="display:inline-block;background:transparent;border:1px solid #e74c3c;color:#e74c3c;padding:10px 24px;border-radius:6px;text-decoration:none;font-weight:600;font-size:13px;">Decline & Delete</a><br/>` : ''}
    <a href="mailto:${email}?subject=BusBrother%20Carrier%20Application" style="display:inline-block;color:#f5a623;padding:10px 24px;text-decoration:none;font-size:13px;margin-top:10px;">Reply to ${data.contact_name}</a>
    <a href="tel:${data.phone}" style="display:inline-block;color:#8a9ab5;padding:10px 24px;text-decoration:none;font-size:13px;">Call ${data.phone}</a>
  </div>
</div></body></html>`;

  const notifyEmails = (env.BUSBROTHER_NOTIFY_EMAIL || 'info@busbrother.com').split(',').map(e => e.trim());
  // Strip BTM and any other vendor emails from carrier-signup notifications - this is internal review only
  const internalEmails = notifyEmails.filter(e => !/btmcoach\.com$/i.test(e));
  await sendEmail(env, {
    to: internalEmails.length ? internalEmails : ['info@busbrother.com'],
    subject: `[BusBrother] New Carrier Application — ${data.company_name}`,
    html: ownerHtml,
    replyTo: email
  });

  // Carrier confirmation
  const carrierHtml = `
<!DOCTYPE html><html><head><meta charset="utf-8"/></head>
<body style="margin:0;padding:0;background:#060e1c;font-family:Arial,Helvetica,sans-serif;">
<div style="max-width:600px;margin:0 auto;padding:20px;">
  <div style="background:#0a1628;border:1px solid #1e3052;border-radius:8px 8px 0 0;padding:24px;text-align:center;">
    <h1 style="margin:0;color:#f8f6f0;font-size:28px;letter-spacing:3px;">BUS<span style="color:#f5a623;">BROTHER</span></h1>
    <p style="color:#8a9ab5;font-size:12px;letter-spacing:2px;margin:8px 0 0;text-transform:uppercase;">Carrier Application Received</p>
  </div>
  <div style="background:#111d33;border-left:1px solid #1e3052;border-right:1px solid #1e3052;padding:24px;">
    <p style="color:#f8f6f0;font-size:15px;margin:0 0 16px;">Hi ${data.contact_name},</p>
    <p style="color:#8a9ab5;font-size:14px;line-height:1.6;margin:0 0 20px;">Thank you for applying to join the BusBrother carrier network. We have received your application for <strong style="color:#f5a623;">${data.company_name}</strong> and will review your credentials within 2 business days.</p>
    <p style="color:#8a9ab5;font-size:14px;line-height:1.6;margin:0 0 20px;">As part of the review, we verify each carrier's:</p>
    <ul style="color:#8a9ab5;font-size:14px;line-height:1.7;margin:0 0 20px;padding-left:20px;">
      <li>USDOT registration and FMCSA operating authority</li>
      <li>Commercial auto liability insurance ($5,000,000 minimum)</li>
      <li>FMCSA safety rating (Satisfactory or None required)</li>
      <li>CDL with Passenger endorsement for all drivers</li>
    </ul>
    <div style="background:rgba(245,166,35,0.08);border:1px solid rgba(245,166,35,0.3);border-radius:6px;padding:16px;margin-bottom:20px;">
      <p style="margin:0 0 8px;color:#f5a623;font-size:13px;font-weight:600;">Phase 1: Free Lead Access (Limited Time)</p>
      <p style="margin:0;color:#f8f6f0;font-size:13px;line-height:1.5;">All BusBrother leads are currently delivered free to approved carriers. The first 5 carriers approved to our network receive <strong>lifetime free lead access</strong> as Founding Carriers. After we reach 5 Founding Carriers, new carriers will pay a per-lead access fee.</p>
    </div>
    <p style="color:#8a9ab5;font-size:14px;line-height:1.6;margin:0 0 20px;">If you have any questions or want to provide additional information (insurance certificates, fleet photos, references), reply to this email.</p>
    <p style="color:#f8f6f0;font-size:15px;margin:0;">— The BusBrother Team</p>
  </div>
  <div style="background:#0a1628;border:1px solid #1e3052;border-radius:0 0 8px 8px;padding:24px;text-align:center;">
    <p style="color:#8a9ab5;font-size:12px;">BusBrother — Brevard County, Florida</p>
    <p style="color:#8a9ab5;font-size:12px;">info@busbrother.com | busbrother.com</p>
  </div>
</div></body></html>`;
  await sendEmail(env, {
    to: email,
    subject: `BusBrother Carrier Application Received — ${data.company_name}`,
    html: carrierHtml,
    replyTo: 'info@busbrother.com'
  });

  if (!ct.includes('application/json')) {
    return new Response(null, { status: 303, headers: { 'Location': '/carriers/thank-you/' } });
  }
  return json({ success: true, vendor_id: vendorId });
}
