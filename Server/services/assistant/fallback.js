const {
  aiDemoLatestQuestion,
  aiDemoIsSmallTalk,
  aiDemoContextQuestion,
} = require("./text");

function createFallbackHelpers() {
  return {
    aiDemoLatestQuestion,
    aiDemoIsSmallTalk,
    aiDemoContextQuestion,
  };
}

module.exports = { createFallbackHelpers };
