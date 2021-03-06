'use strict';

const mongoose = require('mongoose');
const CollectionModel = require('sra-taxii2-server-model/models/collection');
const getPaginatedTaxiiRequest = require('../../lib/get-paginated-taxii-request');
const ModelFactory = require('sra-taxii2-server-model/model-factory');
const buildError = require('../../errors');

const collectionsDataTransformer = (req, collectionMongoResult) => {
    let collectionResponseData = collectionMongoResult.map((val, index) => {
        let newVal = val;
        delete(newVal._id);
        delete(newVal.apiRoot);
        return Object.assign(newVal, {
            // find a way to generalize this, cascade down: check writeall first then api root perms, then individual collection perms
            can_write: req.user.writeAll,
            can_read: req.user.readAll
        });
    });

    let result = {};
    if(collectionResponseData.length > 0)
    {
        result = { collections: collectionResponseData };
    }
    return result;
}

const getCollections = async (req, res, next) => {
    try {
        res.status(200);
        // {} is the query
        res.data = await getPaginatedTaxiiRequest(
            req, 
            res, 
            next, 
            CollectionModel, 
            {}, 
            {
                sort: { name: 1},
                leanWithId: false,
                select: '-_id -__v -updatedAt -createdAt'
            }, 
            collectionsDataTransformer);
        return next()
    } 
    catch(err) {
        next(buildError(500, err));
    }
};

const getCollectionByName = async (req, res, next) => {
    let collectionName = req.params.collectionName || 0;

    try {
        res.status(200);
        let collectionResult = await CollectionModel.findOne({id: collectionName}).select('-__v -updatedAt -createdAt');
        let collectionResponse = collectionsDataTransformer(req, [collectionResult.toJSON()] );
        res.data = collectionResponse.collections[0];
        
        return next();
    } 
    catch (err) {
        next(buildError(500, err));
    }
}

const getCollectionManifestByName = async (req, res, next) => {
    // Not abstracted, only used here so far.
    // Aggregate-paginate is less full featured than base paginate package, too much work to combine them
    // into getPaginatedTaxiiRequest, quick forked the project and added offset, should do a pull req later
    // maybe see if we can get them roughly equivalent
    try {
        res.status(200);
        let models = await ModelFactory.buildTaxii2Models(req.params.apiRootId, req.params.collectionName, process.env.CONNECTION_STRING);
        let filteredQuery = (Object.prototype.hasOwnProperty.call(res.locals, 'taxiiMongooseFilter')) ? res.locals.taxiiMongooseFilter : {};

        let aggregate = models.object.aggregate();
        aggregate.match(filteredQuery).group({
            _id: "$id",
            id: { $first: "$id" },
            date_added: { $first: "$createdAt" },
            versions: { $push: "$created" }
        }).sort({ date_added: 1});

        let envPaginationLimit = parseInt(process.env.PAGINATION_LIMIT);
        let paginationLimit = isNaN(req.range.last) || isNaN(req.range.first) || (req.range.last-req.range.first > (envPaginationLimit - 1)) ?  
            envPaginationLimit : (req.range.last-req.range.first) + 1;

        var options = { offset : req.range.first, limit : paginationLimit };

        let objectsResponse =  await models.object.aggregatePaginate(aggregate, options);

        let objectsData = [];
        if(objectsResponse.data.length > 0) {
            objectsData = objectsResponse.data.map((val, index) => {
                delete val._id;
                return Object.assign(val, {"media_types": ["application/vnd.oasis.stix+json; version=2.0"]});
            });
        }

        let last = objectsData.length -1 + req.range.first;
        res.range({
            first: req.range.first,
            last: last,
            length: objectsResponse.totalCount
        });

        if(last < objectsResponse.totalCount-1) {
            res.status(206);
        }
        res.data = {
            objects: objectsData
        };
        
        return next();
    } 
    catch(err) {
        console.log(err);
        next(buildError(500, err));
    }

    next();
}

module.exports = {
    getCollections: getCollections,
    getCollectionByName: getCollectionByName,
    getCollectionManifestByName: getCollectionManifestByName
};
