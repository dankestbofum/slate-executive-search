'use strict';

/**
 * Sending mail to applicants.
 *
 * Slate has never sent a message. Every existing contact record says that
 * *staff* say they made contact, because the application had no mail server
 * and claiming delivery would have been a lie the search record then carried.
 * The public portal changes that requirement — an applicant who cannot receive
 * a verification code cannot return to their own application — but it must not
 * change that honesty.
 *
 * So this module is an interface with three transports and no provider:
 *
 *   none  — the default. Nothing is sent, and every caller is told so. The
 *           portal refuses to offer an application flow it cannot complete
 *           rather than collecting an address and going quiet.
 *   log   — development. The message is written to the process log, marked as
 *           not delivered. Useful for working on the flow; never a claim.
 *   echo  — the test suite only, and refused outright under NODE_ENV
 *           production. Returns the message to the caller so an automated test
 *           can complete a verification without a mailbox.
 *
 * Choosing and configuring a real provider — sender domain, SPF and DKIM,
 * bounce and complaint handling, suppression lists — is the operations work
 * the plan calls a launch dependency. It is deliberately not guessed at here:
 * `deliver()` is the one function a provider implementation replaces, and
 * everything above it already treats "not delivered" as a normal outcome.
 */

const isProd = process.env.NODE_ENV === 'production';

const TRANSPORTS = ['none', 'log', 'echo'];

function transportName() {
  const chosen = String(process.env.SLATE_MAIL_TRANSPORT || 'none').trim().toLowerCase();
  if (!TRANSPORTS.includes(chosen)) return 'none';
  // A transport that hands the message body back to the caller is a way to
  // read somebody else's verification code. It exists for the test suite and
  // is refused anywhere it could face a real applicant.
  if (chosen === 'echo' && isProd) return 'none';
  return chosen;
}

/**
 * Can this deployment actually complete a flow that needs email?
 *
 * Read before offering the applicant anything that depends on it, so the
 * refusal happens before somebody types their address rather than after.
 */
function configured() {
  return transportName() !== 'none';
}

function status() {
  const transport = transportName();
  return {
    configured: transport !== 'none',
    transport,
    // The honest sentence for an operator reading /api/health.
    note: transport === 'none'
      ? 'No mail provider is configured. Applicant email verification is unavailable, and the portal will not offer it.'
      : transport === 'echo'
        ? 'The test transport is active. Messages are returned to the caller and nothing is delivered.'
        : 'Messages are written to the process log. Nothing is delivered to a real mailbox.'
  };
}

const sent = [];

/**
 * Send one message.
 *
 * Always resolves. A mail failure is never allowed to undo work that has
 * already committed — a received application stays received whether or not its
 * confirmation went out — so callers get a result to record, not an exception
 * to unwind a transaction with.
 *
 * The result separates two things that the existing contact log deliberately
 * keeps apart: that Slate handed the message to a transport, and that a
 * provider confirmed delivery. Nothing here can claim the second.
 */
async function deliver({ to, subject, body, kind }) {
  const transport = transportName();
  const record = {
    at: new Date().toISOString(),
    to: String(to || ''),
    kind: String(kind || 'other'),
    subject: String(subject || ''),
    transport,
    // Handed to a transport. Not the same as delivered, and never rendered as
    // if it were.
    accepted: transport !== 'none',
    deliveryConfirmed: false,
    evidence: 'transport-' + transport
  };

  if (transport === 'none') {
    record.error = 'No mail provider is configured.';
    return record;
  }
  if (transport === 'log') {
    // The code is the point of the message in the only flow that uses this
    // transport, so it goes to the log where a developer can read it. The log
    // is not a place a real applicant's code should ever be, which is why this
    // transport is not the production default.
    console.log('[mail:' + record.kind + '] to ' + record.to + ' — ' + record.subject + '\n' + String(body || ''));
    return record;
  }
  // echo
  record.body = String(body || '');
  sent.push(record);
  if (sent.length > 50) sent.shift();
  return record;
}

/** The test transport's outbox. Empty under every other transport. */
function outbox() {
  return sent.slice();
}

function clearOutbox() {
  sent.length = 0;
}

/* ------------------------------------------------------------------ *
 * The messages
 *
 * Written here rather than at the call sites so there is one place to read
 * what an applicant actually receives. Two rules, both from the plan:
 * confirmation mail carries minimal information and a secure return path, not
 * answers or attachments; and nothing states a hiring status.
 * ------------------------------------------------------------------ */

function verificationMessage({ code, posting, minutes }) {
  return {
    kind: 'verification',
    subject: 'Your verification code' + (posting ? ' for ' + posting : ''),
    body: [
      'Your verification code is ' + code + '.',
      '',
      'It expires in ' + minutes + ' minutes and can be used once.',
      'If you did not ask for this code, you can ignore this message. Nothing has been created.'
    ].join('\n')
  };
}

function receiptMessage({ reference, posting, submittedAt, returnUrl }) {
  return {
    kind: 'receipt',
    subject: 'Application received' + (posting ? ' — ' + posting : ''),
    body: [
      'Your application was received on ' + submittedAt + '.',
      'Reference: ' + reference,
      '',
      'You can return to it here: ' + returnUrl,
      '',
      'This message confirms that your application arrived. It is not a decision,',
      'and it does not mean your application is under review. The search team will',
      'contact you directly about next steps.'
    ].join('\n')
  };
}

module.exports = {
  TRANSPORTS, transportName, configured, status,
  deliver, outbox, clearOutbox,
  verificationMessage, receiptMessage
};
