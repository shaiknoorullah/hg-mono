// Native-only SDK: tests never open the payment sheet.
const React = require('react');
module.exports = {
  StripeProvider: ({ children }) => React.createElement(React.Fragment, null, children),
  initPaymentSheet: async () => ({}),
  presentPaymentSheet: async () => ({}),
};
