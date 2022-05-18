/**
 * Copyright 2020 ChainSafe Systems
 * SPDX-License-Identifier: LGPL-3.0-only
 */

const TruffleAssert = require('truffle-assertions');
const Ethers = require('ethers');

const Helpers = require('../helpers');

const BridgeContract = artifacts.require("Bridge");
const ERC20MintableContract = artifacts.require("ERC20PresetMinterPauser");
const ERC20HandlerContract = artifacts.require("ERC20Handler");

contract('Bridge - [execute proposal]', async (accounts) => {
    const originDomainID = 1;
    const destinationDomainID = 2;

    const depositerAddress = accounts[1];
    const recipientAddress = accounts[2];
    const relayer1Address = accounts[3];


    const initialTokenAmount = 100;
    const depositAmount = 10;
    const expectedDepositNonce = 1;
    const feeData = '0x';

    let BridgeInstance;
    let ERC20MintableInstance;
    let ERC20HandlerInstance;

    let resourceID;
    let depositData;
    let depositProposalData;
    let depositProposalDataHash;

    let data = '';
    let dataHash = '';

    beforeEach(async () => {
        await Promise.all([
            BridgeContract.new(originDomainID).then(instance => BridgeInstance = instance),
            ERC20MintableContract.new("token", "TOK").then(instance => ERC20MintableInstance = instance)
        ]);

        resourceID = Helpers.createResourceID(ERC20MintableInstance.address, originDomainID);

        initialResourceIDs = [resourceID];
        initialContractAddresses = [ERC20MintableInstance.address];
        burnableContractAddresses = [];

        ERC20HandlerInstance = await ERC20HandlerContract.new(BridgeInstance.address);

        await Promise.all([
            ERC20MintableInstance.mint(depositerAddress, initialTokenAmount),
            BridgeInstance.adminSetResource(ERC20HandlerInstance.address, resourceID, ERC20MintableInstance.address)
        ]);

        data = Helpers.createERCDepositData(
          depositAmount,
          20,
          recipientAddress);
        dataHash = Ethers.utils.keccak256(ERC20HandlerInstance.address + data.substr(2));

        await ERC20MintableInstance.approve(ERC20HandlerInstance.address, depositAmount, { from: depositerAddress });

        depositData = Helpers.createERCDepositData(depositAmount, 20, recipientAddress);
        depositProposalData = Helpers.createERCDepositData(depositAmount, 20, recipientAddress)
        depositProposalDataHash = Ethers.utils.keccak256(ERC20HandlerInstance.address + depositProposalData.substr(2));

        // set MPC address to unpause the Bridge
        await BridgeInstance.endKeygen(Helpers.mpcAddress);
    });

    it ('[sanity] bridge configured on domain', async () => {
      assert.equal(await BridgeInstance._domainID(), originDomainID)
    });

    it("isProposalExecuted should be called successfully", async () => {
      await TruffleAssert.passes(BridgeInstance.isProposalExecuted(
          destinationDomainID, expectedDepositNonce
      ));
    });

    it('should create and execute executeProposal successfully', async () => {
      const proposalSignedData = await Helpers.signDataWithMpc(originDomainID, destinationDomainID, expectedDepositNonce, depositProposalData, resourceID);

        // depositerAddress makes initial deposit of depositAmount
        assert.isFalse(await BridgeInstance.paused());
        await TruffleAssert.passes(BridgeInstance.deposit(
            originDomainID,
            resourceID,
            depositData,
            feeData,
            { from: depositerAddress }
        ));

        await TruffleAssert.passes(BridgeInstance.executeProposal(
            originDomainID,
            destinationDomainID,
            expectedDepositNonce,
            depositProposalData,
            resourceID,
            proposalSignedData,
            { from: relayer1Address }
        ));

        // check that deposit nonce has been marked as used in bitmap
        assert.isTrue(await BridgeInstance.isProposalExecuted(originDomainID, expectedDepositNonce));

        // check that tokens are transferred to recipient address
        const recipientBalance = await ERC20MintableInstance.balanceOf(recipientAddress);
        assert.strictEqual(recipientBalance.toNumber(), depositAmount);
    });

    it('executeProposal event should be emitted with expected values', async () => {
      const proposalSignedData = await Helpers.signDataWithMpc(originDomainID, destinationDomainID, expectedDepositNonce, depositProposalData, resourceID);

        // depositerAddress makes initial deposit of depositAmount
        assert.isFalse(await BridgeInstance.paused());
        await TruffleAssert.passes(BridgeInstance.deposit(
            originDomainID,
            resourceID,
            depositData,
            feeData,
            { from: depositerAddress }
        ));

        const proposalTx = await BridgeInstance.executeProposal(
          originDomainID,
          destinationDomainID,
          expectedDepositNonce,
          depositProposalData,
          resourceID,
          proposalSignedData,
            { from: relayer1Address }
        );

        TruffleAssert.eventEmitted(proposalTx, 'ProposalExecution', (event) => {
            return event.originDomainID.toNumber() === originDomainID &&
                event.destinationDomainID.toNumber() === destinationDomainID &&
                event.depositNonce.toNumber() === expectedDepositNonce &&
                event.dataHash === dataHash
        });

        // check that deposit nonce has been marked as used in bitmap
        assert.isTrue(await BridgeInstance.isProposalExecuted(originDomainID, expectedDepositNonce));

        // check that tokens are transferred to recipient address
        const recipientBalance = await ERC20MintableInstance.balanceOf(recipientAddress);
        assert.strictEqual(recipientBalance.toNumber(), depositAmount);
    });
});
