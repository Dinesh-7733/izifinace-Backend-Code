const express = require("express");
const router = express.Router();

router.get("/secrets", (req, res) => {

  if (!global.config) {
    return res.status(503).json({
      status: "initializing",
      message: "Secrets loading... try again."
    });
  }

  return res.json({
    status: "ready",
    environment: global.config.mpesaEnv?.trim(),
    shortcode: global.config.mpesaShortcode?.trim(),

    consumerKeyLoaded: !!global.config.mpesaConsumerKey,
    consumerSecretLoaded: !!global.config.mpesaConsumerSecret,

    confirmURL: global.config.mpesaC2bConfirmUrl?.trim() || null,
    validateURL: global.config.mpesaC2bValidateUrl?.trim() || null
  });
});

module.exports = router;
