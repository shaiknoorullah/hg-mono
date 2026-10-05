/**
 * The fallback for a notification that reaches the email channel without a
 * template of its own: its inbox title and body, nothing else. It keeps a new
 * notification kind from failing to send while its own template is written;
 * every kind the router matrix lists by email should have one
 * (docs/spec/01-platform.md, "P-26 — SMS and email", required templates).
 */
import { Layout, P } from '../components/Layout.js';
import { defineTemplate } from '../define.js';

/** A notification's inbox title and body, for a kind with no template of its own. */
export const generic = defineTemplate({
  name: 'generic',
  vars: ['Title', 'Body'] as const,
  subject: (v) => v.Title,
  render: (v) => (
    <Layout preview={v.Body} heading={v.Title}>
      <P>{v.Body}</P>
    </Layout>
  ),
});
