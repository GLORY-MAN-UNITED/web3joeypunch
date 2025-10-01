// Test script for token minting functionality
const { mintTokensToUser } = require('./mint');

async function testMinting() {
    console.log('Testing token minting functionality...');
    
    // Test wallet address (replace with actual test address)
    const testAddress = '0x7F72dDF0e619F9B1600D9B68979BD5a3F21C01E7';
    
    try {
        console.log(`Attempting to mint 20 tokens to ${testAddress}`);
        const txHash = await mintTokensToUser(testAddress, 20);
        console.log(`✅ Successfully minted tokens! Transaction hash: ${txHash}`);
    } catch (error) {
        console.error('❌ Minting failed:', error.message);
    }
}

// Run the test if this script is executed directly
if (require.main === module) {
    testMinting();
}

module.exports = { testMinting };