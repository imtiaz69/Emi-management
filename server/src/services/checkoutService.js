const { createOrderFromCart } = require("./orderService");

async function checkoutFromCart(payload) {
  return createOrderFromCart(payload);
}

module.exports = { checkoutFromCart };
