/**
 *  ---------
 * |.##> <##.|  Open Smart Card Development Platform (www.openscdp.org)
 * |#       #|  
 * |#       #|  Copyright (c) 1999-2009 CardContact Software & System Consulting
 * |'##> <##'|  Andreas Schwier, 32429 Minden, Germany (www.cardcontact.de)
 *  --------- 
 *
 *  This file is part of OpenSCDP.
 *
 *  OpenSCDP is free software; you can redistribute it and/or modify
 *  it under the terms of the GNU General Public License version 2 as
 *  published by the Free Software Foundation.
 *
 *  OpenSCDP is distributed in the hope that it will be useful,
 *  but WITHOUT ANY WARRANTY; without even the implied warranty of
 *  MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 *  GNU General Public License for more details.
 *
 *  You should have received a copy of the GNU General Public License
 *  along with OpenSCDP; if not, write to the Free Software
 *  Foundation, Inc., 51 Franklin St, Fifth Floor, Boston, MA  02110-1301  USA
 *
 * @fileoverview Implementation of the Extended Access Control protocol in version 2.0
 */


load("tools/eccutils.js");

load("pace.js");
load("chipauthentication.js");
load("cvcertstore.js");



function EAC20(crypto, card) {
	this.crypto = crypto;
	this.card = card;
	this.sm = null;

	// ToDo: Determine from CVCA Certificate
	this.oidTerminalAuthentication = EAC20.id_TA_ECDSA_SHA_256;
}



EAC20.ID_MRZ = 1;
EAC20.ID_CAN = 2;
EAC20.ID_PIN = 3;
EAC20.ID_PUK = 4;



EAC20.prototype.processSecurityInfos = function(si, fromCardSecurity) {
	GPSystem.trace("SecurityInfos:");
	GPSystem.trace(si);
	
	var id_PACE = new ByteString("id-PACE", OID);
	var id_PACE_DH_GM = new ByteString("id-PACE-DH-GM", OID);
	var id_PACE_ECDH_GM = new ByteString("id-PACE-ECDH-GM", OID);
	var id_PACE_DH_IM = new ByteString("id-PACE-DH-IM", OID);
	var id_PACE_ECDH_IM = new ByteString("id-PACE-ECDH-IM", OID);
	var id_PK_ECDH = new ByteString("id-PK-ECDH", OID);
	var id_CA = new ByteString("id-CA", OID);
	var id_CA_DH = new ByteString("id-CA-DH", OID);
	var id_CA_ECDH = new ByteString("id-CA-ECDH", OID);
	var id_TA = new ByteString("id-TA", OID);
	var id_RI = new ByteString("id-RI", OID);
	var id_RI_DH = new ByteString("id-RI-DH", OID);
	var id_RI_ECDH = new ByteString("id-RI-ECDH", OID);
	
	for (var i = 0; i < si.elements; i++) {
		var o = si.get(i);
		assert((o.elements >= 1) && (o.elements <= 3));
		
		var oid = o.get(0);
		assert(oid.tag == ASN1.OBJECT_IDENTIFIER);
		
		if (oid.value.startsWith(id_TA) == id_TA.length) {
//			print("TA : " + o);
		} else if (oid.value.equals(id_PK_ECDH)) {
//			print("CA Public Key: " + o);
			this.cAPublicKey = o.get(1).get(1).value.bytes(1);
//			print(this.cAPublicKey);
		} else if (oid.value.startsWith(id_PACE) == id_PACE.length) {
			if (oid.value.equals(id_PACE_DH_GM) ||
				oid.value.equals(id_PACE_ECDH_GM) ||
				oid.value.equals(id_PACE_DH_IM) ||
				oid.value.equals(id_PACE_ECDH_GM)) {
//				print("PaceDomainParameterInfo : " + o);
				
				var pdpi = new PACEDomainParameterInfo(o);
//				print(pdpi);
				
				var id = pdpi.parameterId;
				
				if (typeof(id) == "undefined") {
					id = 0;
				}
				
				if (!fromCardSecurity && (typeof(this.PACEDPs[id]) != "undefined")) {
					throw new GPError("EAC20", GPError.INVALID_DATA, 0, "Duplicate parameterId " + id + " for PACEDomainParameter");
				}
				
				this.PACEDPs[id] = pdpi;
			} else {
//				print("PaceInfo : " + o);

				var pi = new PACEInfo(o);
//				print(pi);
				
				var id = pi.parameterId;
				
				if (typeof(id) == "undefined") {
					id = 0;
				}
				
				if (!fromCardSecurity && (typeof(this.PACEInfos[id]) != "undefined")) {
					throw new GPError("EAC20", GPError.INVALID_DATA, 0, "Duplicate parameterId " + id + " for PACEInfo");
				}
				
				this.PACEInfos[id] = pi;
			}
		} else if (oid.value.startsWith(id_CA) == id_CA.length) {
			if (oid.value.equals(id_CA_DH) ||
				oid.value.equals(id_CA_ECDH)) {
//				print("ChipAuthenticationDomainParameterInfo : " + o);
				
				var cadpi = new ChipAuthenticationDomainParameterInfo(o);
//				print(cadpi);
				
				var id = cadpi.keyId;
				
				if (typeof(id) == "undefined") {
					id = 0;
				}
				
				if (!fromCardSecurity && (typeof(this.CADPs[id]) != "undefined")) {
					throw new GPError("EAC20", GPError.INVALID_DATA, 0, "Duplicate keyId " + id + " for ChipAuthenticationDomainParameter");
				}
				
				this.CADPs[id] = cadpi;
			} else {
//				print("ChipAuthenticationInfo : " + o);

				var cai = new ChipAuthenticationInfo(o);
//				print(cai);
				
				var id = cai.keyId;
				
				if (typeof(id) == "undefined") {
					id = 0;
				}
				
				if (!fromCardSecurity && (typeof(this.CAInfos[id]) != "undefined")) {
					throw new GPError("EAC20", GPError.INVALID_DATA, 0, "Duplicate keyId " + id + " for ChipAuthenticationInfo");
				}
				
				this.CAInfos[id] = cai;
			}
		}
	}
}



EAC20.prototype.readCardInfo = function() {
	var mf = new CardFile(card, ":3F00");
	this.mf = mf;
	
	var ci = new CardFile(mf, ":011C");
	var cibin = ci.readBinary();
	var citlv = new ASN1(cibin);
//	print(citlv);
	
	this.PACEInfos = new Array();
	this.PACEDPs = new Array();

	this.CAInfos = new Array();
	this.CADPs = new Array();
	
	this.processSecurityInfos(citlv, false);
}



EAC20.prototype.readCardSecurity = function() {
	var cs = new CardFile(this.mf, ":011D");
	var csbin = cs.readBinary();
	var cstlv = new ASN1(csbin);
	GPSystem.trace("EF.CardSecurity:");
	GPSystem.trace(cstlv);
	
	var cms = new CMSSignedData(csbin);

	var certs = cms.getSignedDataCertificates();

	GPSystem.trace("EF.CardSecurity Certificates:");
	for (var i = 0; i < certs.length; i++) {
		GPSystem.trace(certs[i]);
	}

	print("DocSigner Signature is " + (cms.isSignerInfoSignatureValid(0) ? "valid" : "not valid"));

	var data = cms.getSignedContent();

//	print(data);

	var cstlv = new ASN1(data);

//	print(cstlv);
	
	this.processSecurityInfos(cstlv, true);
}



EAC20.prototype.getPACEInfos = function() {
	return this.PACEInfos;
}



EAC20.prototype.getPACEDomainParameterInfos = function() {
	return this.PACEDPs;
}



EAC20.prototype.getCAnfos = function() {
	return this.CAInfos;
}



EAC20.prototype.getCADomainParameterInfos = function() {
	return this.CADPs;
}



/**
 * Perform PACE using the indicated parameter set, the identified password, the password value and
 * an optional cardholder authentication template.
 *
 * @param {Number} parameterId the identifier for the PACEInfo and PACEDomainParameterInfo from EF.CardInfo. Use 0 for
 *                             the default.
 * @param {Number} pwdid one of EAC20.ID_MRZ, EAC20.ID_CAN, EAC20.ID_PIN, EAC20.ID_PUK
 * @param {ByteString} pwd the PACE password
 * @param {ASN1} chat the CHAT data object with tag 7F4C or null
 *
 * @return the secure channel established by PACE
 * @type IsoSecureChannel
 */
EAC20.prototype.performPACE = function(parameterId, pwdid, pwd, chat) {

	var paceinfo = this.PACEInfos[parameterId];
	if (typeof(paceinfo) == "undefined") {
		throw new GPError("EAC20", GPError.INVALID_DATA, 0, "Unknown parameterId " + parameterId + " for PACEInfo");
	}
	
	var pacedp = this.PACEDPs[parameterId];
	if (typeof(pacedp) == "undefined") {
		throw new GPError("EAC20", GPError.INVALID_DATA, 0, "Unknown parameterId " + parameterId + " for PACEDomainParameterInfo");
	}

	if (!(pwd instanceof ByteString)) {
		throw new GPError("EAC20", GPError.INVALID_TYPE, 0, "Argument pwd must be of type ByteString");
	}
	
	if ((chat != null) && !(chat instanceof ASN1)) {
		throw new GPError("EAC20", GPError.INVALID_TYPE, 0, "Argument chat must be of type ASN1");
	}

	
	var pace = new PACE(this.crypto, paceinfo.protocol, pacedp.domainParameter);
	pace.setPassword(pwd);

	// Manage SE
	var crt = new ByteBuffer();
	crt.append((new ASN1(0x80, paceinfo.protocol)).getBytes());
	crt.append(new ByteString("8301", HEX));
	crt.append(pwdid);
	if (chat != null) {
		crt.append(chat.getBytes());
	}

	card.sendSecMsgApdu(Card.CPRO|Card.CENC|Card.RPRO, 0x00, 0x22, 0xC1, 0xA4, crt.toByteString(), [0x9000, 0x63C2, 0x63C1, 0x63C0, 0x6283 ]);


	// General Authenticate
	var dado = new ASN1(0x7C);

	dadobin = card.sendSecMsgApdu(Card.CPRO|Card.CENC|Card.RPRO|Card.RENC, 0x10, 0x86, 0x00, 0x00, dado.getBytes(), 0, [0x9000]);

	var dado = new ASN1(dadobin);
	assert(dado.tag == 0x7C);
	assert(dado.elements == 1);
	var encryptedNonceDO = dado.get(0);
	assert(encryptedNonceDO.tag == 0x80);
	var encryptedNonce = encryptedNonceDO.value;

	GPSystem.trace("Encrypted nonce: " + encryptedNonce);

	pace.decryptNonce(encryptedNonce);

	var mappingData = pace.getMappingData();

	var dado = new ASN1(0x7C, new ASN1(0x81, mappingData));

	dadobin = card.sendSecMsgApdu(Card.CPRO|Card.CENC|Card.RPRO|Card.RENC, 0x10, 0x86, 0x00, 0x00, dado.getBytes(), 0, [0x9000]);

	var dado = new ASN1(dadobin);
	assert(dado.tag == 0x7C);
	assert(dado.elements == 1);
	var mappingDataDO = dado.get(0);
	assert(mappingDataDO.tag == 0x82);

	pace.performMapping(mappingDataDO.value);

	var ephemeralPublicKeyIfd = pace.getEphemeralPublicKey();

	var dado = new ASN1(0x7C, new ASN1(0x83, ephemeralPublicKeyIfd));

	dadobin = card.sendSecMsgApdu(Card.CPRO|Card.CENC|Card.RPRO|Card.RENC, 0x10, 0x86, 0x00, 0x00, dado.getBytes(), 0, [0x9000]);

	var dado = new ASN1(dadobin);
	assert(dado.tag == 0x7C);
	assert(dado.elements == 1);
	var ephemeralPublicKeyICC = dado.get(0);
	assert(ephemeralPublicKeyICC.tag == 0x84);

	this.idPICC = ephemeralPublicKeyICC.value.bytes(1, (ephemeralPublicKeyICC.value.length - 1) >> 1);
	GPSystem.trace("ID_PICC : " + this.idPICC);
	
	pace.performKeyAgreement(ephemeralPublicKeyICC.value);


	var authToken = pace.calculateAuthenticationToken();

	var dado = new ASN1(0x7C, new ASN1(0x85, authToken));

	dadobin = card.sendSecMsgApdu(Card.CPRO|Card.CENC|Card.RPRO|Card.RENC, 0x00, 0x86, 0x00, 0x00, dado.getBytes(), 0, [0x9000, 0x63C2, 0x63C1, 0x63C0, 0x6283 ]);

	var dado = new ASN1(dadobin);
	GPSystem.trace(dado);
	assert(dado.tag == 0x7C);
	assert(dado.elements >= 1);
	assert(dado.elements <= 3);
	var authTokenDO = dado.get(0);
	assert(authTokenDO.tag == 0x86);

	if (dado.elements > 1) {
		var cardo = dado.get(1);
		assert(cardo.tag == 0x87);
		this.lastCAR = new PublicKeyReference(cardo.value);
	}
	
	if (dado.elements > 2) {
		var cardo = dado.get(2);
		assert(cardo.tag == 0x88);
		this.previousCAR = new PublicKeyReference(cardo.value);
	}

	var sm = null;
	
	if (pace.verifyAuthenticationToken(authTokenDO.value)) {
		GPSystem.trace("Authentication token valid");

		sm = new IsoSecureChannel(crypto, IsoSecureChannel.SSC_SYNC_ENC_POLICY);
		sm.setEncKey(pace.kenc);
		sm.setMacKey(pace.kmac);
		sm.setMACSendSequenceCounter(new ByteString("00000000000000000000000000000000", HEX));
		this.mf.setCredential(CardFile.ALL, Card.ALL, sm);
		this.card.setCredential(sm);
	}
	this.sm = sm;
}



EAC20.prototype.getTrustAnchorCAR = function(previous) {
	if (previous) {
		return this.previousCAR;
	} else {
		return this.lastCAR;
	}
}



EAC20.prototype.verifyCertificateChain = function(cvcchain) {
	for (var i = 0; i < cvcchain.length; i++) {
		var cvc = cvcchain[i];
		
		var car = cvc.getCAR().getBytes();
		
		var pukrefdo = new ASN1(0x83, car);
		var pukref = pukrefdo.getBytes();
		
//		print("PuKref: " + pukref);
//		print(pukref);
		this.card.sendSecMsgApdu(Card.CPRO|Card.CENC|Card.RPRO, 0x00, 0x22, 0x81, 0xB6, pukref, [0x9000]);
		
		// Extract value of 7F21
		var tl = new TLVList(cvc.getBytes(), TLV.EMV);
		var t = tl.index(0);
		var v = t.getValue();
		
		GPSystem.trace("Certificate: ");
		GPSystem.trace(new ASN1(v));
		this.card.sendSecMsgApdu(Card.CPRO|Card.CENC|Card.RPRO, 0x00, 0x2A, 0x00, 0xBE, v, [0x9000]);
	}
	
	this.terminalCHR = cvcchain[cvcchain.length - 1].getCHR();
}



EAC20.prototype.performTerminalAuthentication = function(termkey, auxdata) {
	var signatureInput = this.performTerminalAuthenticationSetup(auxdata);
	
	var signature = this.crypto.sign(termkey, Crypto.ECDSA_SHA256, signatureInput);

	GPSystem.trace("Signature (Encoded):");
	GPSystem.trace(signature);

	signature = ECCUtils.unwrapSignature(signature);
	GPSystem.trace("Signature (Encoded):");
	GPSystem.trace(signature);

	this.performTerminalAuthenticationFinal(signature);
}



EAC20.prototype.performTerminalAuthenticationSetup = function(auxdata) {

	var idIFD = this.ca.getCompressedPublicKey();

	var bb = new ByteBuffer();
	
	// ToDo: Copy from root CVCA certificate
	bb.append(new ASN1(0x80, new ByteString("id-TA-ECDSA-SHA-256", OID)).getBytes());
	bb.append(new ASN1(0x83, this.terminalCHR.getBytes()).getBytes());
//	bb.append(auxdata);
	bb.append(new ASN1(0x91, idIFD).getBytes());
	
	var msedata = bb.toByteString();
	GPSystem.trace("Manage SE data:");
	GPSystem.trace(msedata);
	this.card.sendSecMsgApdu(Card.CPRO|Card.CENC|Card.RPRO, 0x00, 0x22, 0x81, 0xA4, msedata, [0x9000]);
	
	var challenge = this.card.sendSecMsgApdu(Card.CPRO|Card.CENC|Card.RPRO|Card.RENC, 0x00, 0x84, 0x00, 0x00, 8, [0x9000]);
	
	var bb = new ByteBuffer();
	bb.append(this.idPICC);
	bb.append(challenge);
	bb.append(idIFD);
	
	var signatureInput = bb.toByteString();
	GPSystem.trace("Signature Input:");
	GPSystem.trace(signatureInput);
	return signatureInput;
}


	
EAC20.prototype.performTerminalAuthenticationFinal = function(signature) {
	this.card.sendSecMsgApdu(Card.CPRO|Card.CENC|Card.RPRO, 0x00, 0x82, 0x00, 0x00, signature, [0x9000]);
}



EAC20.prototype.prepareChipAuthentication = function(keyId) {
	var cainfo = this.CAInfos[keyId];
	if (typeof(cainfo) == "undefined") {
		throw new GPError("EAC20", GPError.INVALID_DATA, 0, "Unknown keyId " + keyId + " for ChipAuthenticationInfo");
	}
	this.cainfo = cainfo;
	
	var cadp = this.CADPs[keyId];
	if (typeof(cadp) == "undefined") {
		throw new GPError("EAC20", GPError.INVALID_DATA, 0, "Unknown keyId " + keyId + " for ChipAuthenticationDomainParameterInfo");
	}
	this.cadp = cadp;

	this.ca = new ChipAuthentication(this.crypto, cainfo.protocol, cadp.domainParameter);
	
	this.ca.generateEphemeralCAKeyPair();
}



EAC20.prototype.performChipAuthentication = function() {

	var bb = new ByteBuffer();
	bb.append(new ASN1(0x80, this.cainfo.protocol).getBytes());
	
	if (typeof(this.cainfo.keyId) != "undefined") {
		bb.append(new ByteString("8401", HEX));
		bb.append(this.cainfo.keyId);
	}
	
	var msedata = bb.toByteString();
	GPSystem.trace("Manage SE data:");
	GPSystem.trace(msedata);
	this.card.sendSecMsgApdu(Card.CPRO|Card.CENC|Card.RPRO, 0x00, 0x22, 0x41, 0xA4, msedata, [0x9000]);
	
	var ephemeralPublicKeyIfd = this.ca.getEphemeralPublicKey();

	var dado = new ASN1(0x7C, new ASN1(0x80, ephemeralPublicKeyIfd));

	var dadobin = card.sendSecMsgApdu(Card.CPRO|Card.CENC|Card.RPRO|Card.RENC, 0x00, 0x86, 0x00, 0x00, dado.getBytes(), 0, [0x9000]);
	
//	print(dadobin);

	var dado = new ASN1(dadobin);
	assert(dado.tag == 0x7C);
	assert(dado.elements == 2);
	var nonceDO = dado.get(0);
	assert(nonceDO.tag == 0x81);
	var nonce = nonceDO.value;

	var authTokenDO = dado.get(1);
	assert(authTokenDO.tag == 0x82);
	var authToken = authTokenDO.value;
	
	this.ca.performKeyAgreement(this.cAPublicKey, nonce);
	
	if (this.ca.verifyAuthenticationToken(authToken)) {
		GPSystem.trace("Authentication token valid");

		var sm = new IsoSecureChannel(crypto, IsoSecureChannel.SSC_SYNC_ENC_POLICY);
		sm.setEncKey(this.ca.kenc);
		sm.setMacKey(this.ca.kmac);
		sm.setMACSendSequenceCounter(new ByteString("00000000000000000000000000000000", HEX));
		this.mf.setCredential(CardFile.ALL, Card.ALL, sm);
		this.card.setCredential(sm);
		this.sm = sm;
	}
}



EAC20.prototype.performRestrictedIdentification = function(keyId, sectorPublicKey) {
	var bb = new ByteBuffer();
	bb.append(new ASN1(0x80, new ByteString("id-RI-ECDH-SHA-256", OID)).getBytes());
	
	bb.append(new ByteString("8401", HEX));
	bb.append(keyId);
	
	var msedata = bb.toByteString();
	GPSystem.trace("Manage SE data:");
	GPSystem.trace(msedata);
	this.card.sendSecMsgApdu(Card.CPRO|Card.CENC|Card.RPRO, 0x00, 0x22, 0x41, 0xA4, msedata, [0x9000]);
	
	var dado = new ASN1(0x7C, new ASN1(0xA0, sectorPublicKey.bytes(5)));

//	print("GA Input: " + dado.getBytes());
	
	var dadobin = card.sendSecMsgApdu(Card.CPRO|Card.CENC|Card.RPRO|Card.RENC, 0x00, 0x86, 0x00, 0x00, dado.getBytes(), 65535, [0x9000]);
	
//	print(dadobin);

	var dado = new ASN1(dadobin);
	assert(dado.tag == 0x7C);
	assert(dado.elements == 1);
	var nonceDO = dado.get(0);
	assert((nonceDO.tag == 0x81) || (nonceDO.tag == 0x83));
	var sectorId = nonceDO.value;

//	print("Sector specific identifier: " + sectorId);
	return sectorId;
}
