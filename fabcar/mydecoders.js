var grpc = require('grpc');
var Long = require('long')
var _responseProto = grpc.load(__dirname + '/node_modules/fabric-client/lib/protos/peer/proposal_response.proto').protos;
var _proposalProto = grpc.load(__dirname + '/node_modules/fabric-client/lib/protos/peer/proposal.proto').protos;
var _rwsetProto = grpc.load(__dirname + '/node_modules/fabric-client/lib/protos/ledger/rwset/rwset.proto').rwset;
var _kv_rwsetProto = grpc.load(__dirname + '/node_modules/fabric-client/lib/protos/ledger/rwset/kvrwset/kv_rwset.proto').kvrwset;
var _ccEventProto = grpc.load(__dirname + '/node_modules/fabric-client/lib/protos/peer/chaincode_event.proto').protos;
var _blockchainInfoProto = grpc.load(__dirname + '/node_modules/fabric-client/lib/protos/common/ledger.proto').common;


module.exports = function decodeBlockchainInfo(blockchain_info_bytes) {
	var blockchain_info_payload = {} 
	var blockchain_info = _blockchainInfoProto.BlockchainInfo.decode(blockchain_info_bytes);
	blockchain_info_payload.height = Long.fromValue(blockchain_info.getHeight(), true).toNumber()
	blockchain_info_payload.currentBlockHash = blockchain_info.getCurrentBlockHash().toBuffer().toString('hex')
	blockchain_info_payload.previousBlockHash = blockchain_info.getPreviousBlockHash().toBuffer().toString('hex')

	return blockchain_info_payload;
}


function decodeProposalResponsePayload(proposal_response_payload_bytes) {
	var proposal_response_payload = {};
	var proto_proposal_response_payload = _responseProto.ProposalResponsePayload.decode(proposal_response_payload_bytes);
	proposal_response_payload.proposal_hash = proto_proposal_response_payload.getProposalHash().toBuffer().toString('hex');
	proposal_response_payload.extension = decodeChaincodeAction(proto_proposal_response_payload.getExtension());

	return proposal_response_payload;
}

function decodeChaincodeAction(action_bytes) {
	var chaincode_action = {};
	var proto_chaincode_action = _proposalProto.ChaincodeAction.decode(action_bytes);
	chaincode_action.results = decodeReadWriteSets(proto_chaincode_action.getResults());
	chaincode_action.events = decodeChaincodeEvents(proto_chaincode_action.getEvents());
	chaincode_action.response = decodeResponse(proto_chaincode_action.getResponse());
	chaincode_action.chaincode_id = decodeChaincodeID(proto_chaincode_action.getChaincodeId());

	return chaincode_action;
}

function decodeReadWriteSets(rw_sets_bytes) {
	var proto_tx_read_write_set = _rwsetProto.TxReadWriteSet.decode(rw_sets_bytes);
	var tx_read_write_set = {};
	tx_read_write_set.data_model = proto_tx_read_write_set.getDataModel();
	if (proto_tx_read_write_set.getDataModel() === _rwsetProto.TxReadWriteSet.DataModel.KV) {
		tx_read_write_set.ns_rwset = [];
		let proto_ns_rwset = proto_tx_read_write_set.getNsRwset();
		for (let i in proto_ns_rwset) {
			let kv_rw_set = {};
			let proto_kv_rw_set = proto_ns_rwset[i];
			kv_rw_set.namespace = proto_kv_rw_set.getNamespace();
			kv_rw_set.rwset = decodeKVRWSet(proto_kv_rw_set.getRwset());
			tx_read_write_set.ns_rwset.push(kv_rw_set);
		}
	} else {
		// not able to decode this type of rw set, return the array of byte[]
		tx_read_write_set.ns_rwset = proto_tx_read_write_set.getNsRwset();
	}

	return tx_read_write_set;
}

function decodeKVRWSet(kv_bytes) {
	var proto_kv_rw_set = _kv_rwsetProto.KVRWSet.decode(kv_bytes);
	var kv_rw_set = {};

	// KV readwrite set has three arrays
	kv_rw_set.reads = [];
	kv_rw_set.range_queries_info = [];
	kv_rw_set.writes = [];

	// build reads
	let reads = kv_rw_set.reads;
	var proto_reads = proto_kv_rw_set.getReads();
	for (let i in proto_reads) {
		reads.push(decodeKVRead(proto_reads[i]));
	}

	// build range_queries_info
	let range_queries_info = kv_rw_set.range_queries_info;
	var proto_range_queries_info = proto_kv_rw_set.getRangeQueriesInfo();
	for (let i in proto_range_queries_info) {
		range_queries_info.push(decodeRangeQueryInfo(proto_range_queries_info[i]));
	}

	// build writes
	let writes = kv_rw_set.writes;
	var proto_writes = proto_kv_rw_set.getWrites();
	for (let i in proto_writes) {
		writes.push(decodeKVWrite(proto_writes[i]));
	}

	return kv_rw_set;
}

function decodeKVRead(proto_kv_read) {
	let kv_read = {};
	kv_read.key = proto_kv_read.getKey();
	let proto_version = proto_kv_read.getVersion();
	if (proto_version) {
		kv_read.version = {};
		kv_read.version.block_num = proto_version.getBlockNum().toString();
		kv_read.version.tx_num = proto_version.getTxNum().toString();
	} else {
		kv_read.version = null;
	}

	return kv_read;
}

function decodeRangeQueryInfo(proto_range_query_info) {
	let range_query_info = {};
	range_query_info.start_key = proto_range_query_info.getStartKey();
	range_query_info.end_key = proto_range_query_info.getEndKey();
	range_query_info.itr_exhausted = proto_range_query_info.getItrExhausted();

	// reads_info is one of QueryReads
	let proto_raw_reads = proto_range_query_info.getRawReads();
	if (proto_raw_reads) {
		range_query_info.raw_reads = {};
		range_query_info.raw_reads.kv_reads = [];
		for (let i in proto_raw_reads.kv_reads) {
			let kv_read = decodeKVRead(proto_raw_reads.kv_reads[i]);
			range_query_info.raw_reads.kv_reads.push(kv_read);
		}
	}
	// or QueryReadsMerkleSummary
	let proto_reads_merkle_hashes = proto_range_query_info.getReadsMerkleHashes();
	if (proto_reads_merkle_hashes) {
		range_query_info.reads_merkle_hashes = {};
		range_query_info.reads_merkle_hashes.max_degree = proto_reads_merkle_hashes.getMaxDegree();
		range_query_info.reads_merkle_hashes.max_level = proto_reads_merkle_hashes.getMaxLevel();
		range_query_info.reads_merkle_hashes.max_level_hashes = proto_reads_merkle_hashes.getMaxLevelHashes();
	}

	return range_query_info;
}

function decodeKVWrite(proto_kv_write) {
	let kv_write = {};
	kv_write.key = proto_kv_write.getKey();
	kv_write.is_delete = proto_kv_write.getIsDelete();
	kv_write.value = proto_kv_write.getValue().toBuffer().toString();

	return kv_write;
}

function decodeChaincodeEvents(event_bytes) {
	var events = {};
	var proto_events = _ccEventProto.ChaincodeEvent.decode(event_bytes);
	events.chaincode_id = proto_events.getChaincodeId();
	events.tx_id = proto_events.getTxId();
	events.event_name = proto_events.getEventName();
	events.payload = proto_events.getPayload().toBuffer();

	return events;
}

function decodeResponse(proto_response) {
	if (!proto_response) return null;
	var response = {};
	response.status = proto_response.getStatus();
	response.message = proto_response.getMessage();
	response.payload = proto_response.getPayload().toBuffer().toString();

	return response;
}

function decodeChaincodeID(proto_chaincode_id) {
	var chaincode_id = {};
	if(!proto_chaincode_id) {
		console.log('decodeChaincodeID - no proto_chaincode_id found');
		return chaincode_id;
	}
	chaincode_id.path = proto_chaincode_id.getPath();
	chaincode_id.name = proto_chaincode_id.getName();
	chaincode_id.version = proto_chaincode_id.getVersion();

	return chaincode_id;
}