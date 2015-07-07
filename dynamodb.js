var AWS = require( 'aws-sdk' );
var Q = require( 'q' );

var mapDynamoObjectToJavascriptObject = function( item ) {

    if ( !item ) {
        return null;
    }

    var o = {};

    for ( key in item ) {
        if ( item.hasOwnProperty( key ) ) {
            var currentProperty = item[ key ];

            if ( currentProperty[ 'S' ] ) {
                o[ key ] = currentProperty.S;
            }
            else if ( currentProperty[ 'SS' ] ) {
                o[ key ] = currentProperty.SS;
            }
            else if ( currentProperty[ 'BOOL' ] ) {
                o[ key ] = currentProperty.BOOL;
            }
            else if ( currentProperty[ 'N' ] ) {
                o[ key ] = currentProperty.N;
            }
            else if ( currentProperty[ 'NS' ] ) {
                o[ key ] = currentProperty.NS;
            }

            //TODO: Handle data types B, BS, L, M, and NULL
        }
    }

    return o;

};

var mapDynamoObjectsToJavascriptObjects = function( items ) {
    return items.map( mapDynamoObjectToJavascriptObject );
};

var mapJavascriptObjectToDynamoObject = function( item ) {

    if ( !item ) {
        return null;
    }

    var o = {};

    for ( key in item ) {
        if ( item.hasOwnProperty( key ) ) {
            var currentProperty = item[ key ];

            if ( typeof currentProperty === 'string' ) {
                o[ key ] = { "S": currentProperty };
            }
            else if ( typeof currentProperty === 'number' ) {
                o[ key ] = { "N": currentProperty.toString() };
            }
            else if ( typeof currentProperty === 'boolean' ) {
                o[ key ] = { "BOOL": currentProperty };
            }
            else if ( Array.isArray( currentProperty ) ) {
                if ( currentProperty.length ) {
                    if ( typeof currentProperty[ 0 ] === 'string' ) {
                        o[ key ] = { "SS": currentProperty };
                    }
                    else if ( typeof currentProperty[ 0 ] === 'number' ) {
                        o[ key ] = { "NS": currentProperty.map( function( currentValue ) { return currentValue.toString() } ) };
                    }
                }
                else {
                    o[ key ] = { "SS": [] };
                }
            }
        }
    }

    return o;

};

/**
 * Example Condition Definition (with all the bells and whistles)
 *
 * {
 *   userId: 5, //where key = 5
 *   createdDate: {
 *     ">": 1427517440482
 *   }, //createdDate > 1427517440482
 *   OR: [
 *      { name: "tacos" },
 *      { type: "tex-mex" },
 *      { AND: [
 *          { type: "mexican" },
 *          { region: "america" }
 *        ]
 *      }
 *   ], //either name = tacos OR type = tex-mex OR ( type = mexican AND region = america )
 *   mealType: {
 *      IN: [ "lunch", "dinner" ]
 *   }, //mealType is one of "lunch" or "dinner"
 *   rating: {
 *      BETWEEN: [ 3, 5 ]
 *   }, //rating is between 3 and 5
 *   NOT: {
 *      active: false
 *   }, //it is NOT the case that the active property = false
 *   title: {
 *      STARTS_WITH: "The Best" //TODO: Functions like STARTS_WITH need to be implemented
 *   }
 * }
 *
 * See http://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Expressions.SpecifyingConditions.html#Expressions.SpecifyingConditions.ConditionExpressions
 * for more information concerning Condition Expressions
 *
 * @param conditionDefinition
 * @returns {{conditionExpression, expressionAttributeNames: {}, expressionAttributeValues}}
 */
var mapConditionDefinitionToConditionExpression = function( conditionDefinition ) {

    var expressionAttributeNames = {},
        namesForExpressionAttributes = {},
        expressionAttributeValues = {},
        valuesForExpressionAttributes = {},
        expressionAttributeValuesCount = 1,
        expressionAttributeNamesCount = 1;

    var writeOperatorExpression = function( conditionKey, operator, values ) {

        switch( operator ) {
            case '=':
            case '>':
            case '>=':
            case '<':
            case '<=':
            case '<>':
                if ( !valuesForExpressionAttributes[ values ] ) {
                    valuesForExpressionAttributes[ values ] = ':' + expressionAttributeValuesCount;
                    expressionAttributeValues[ ':' + expressionAttributeValuesCount ] = values;
                    expressionAttributeValuesCount += 1;
                }
                return namesForExpressionAttributes[ conditionKey ] + ' ' + operator + ' ' + valuesForExpressionAttributes[ values ];
            case 'IN':
                if ( !Array.isArray( values ) ) {
                    throw Error( 'IN statement for key ' + conditionKey + ' does not have an Array value' );
                }

                var valuePlaceholders = [];

                values.forEach( function( currentValue ) {
                    if ( !valuesForExpressionAttributes[ currentValue ] ) {
                        valuesForExpressionAttributes[ currentValue ] = ':' + expressionAttributeValuesCount;
                        expressionAttributeValues[ ':' + expressionAttributeValuesCount ] = currentValue;
                        expressionAttributeValuesCount += 1;
                    }

                    valuePlaceholders.push( valuesForExpressionAttributes[ currentValue ] );
                } );

                return namesForExpressionAttributes[ conditionKey ] + ' IN (' + valuePlaceholders.join( ', ' ) + ')';
            case 'BETWEEN':
                if ( !Array.isArray( values ) || values.length != 2 ) {
                    throw Error( 'BETWEEN statement for key ' + conditionKey + ' requires two values in an array' );
                }

                var betweenValuePlaceholders = [];

                values.forEach( function( currentValue ) {
                    if ( !valuesForExpressionAttributes[ currentValue ] ) {
                        valuesForExpressionAttributes[ currentValue ] = ':' + expressionAttributeValuesCount;
                        expressionAttributeValues[ ':' + expressionAttributeValuesCount ] = currentValue;
                        expressionAttributeValuesCount += 1;
                    }

                    betweenValuePlaceholders.push( valuesForExpressionAttributes[ currentValue ] );
                } );

                return namesForExpressionAttributes[ conditionKey ] + ' BETWEEN ' + betweenValuePlaceholders[ 0 ] + ' AND ' + betweenValuePlaceholders[ 1 ];
            case 'CONTAINS':
                if ( !valuesForExpressionAttributes[ values ] ) {
                    valuesForExpressionAttributes[ values ] = ':' + expressionAttributeValuesCount;
                    expressionAttributeValues[ ':' + expressionAttributeValuesCount ] = values;
                    expressionAttributeValuesCount += 1;
                }

                return 'contains ( ' + namesForExpressionAttributes[ conditionKey ] + ', ' + valuesForExpressionAttributes[ values ] + ' )';
            default:
                throw new Error( 'Invalid operator ' + operator + ' for key ' + conditionKey );
        }
    };

    /**
     * An operatorDefinition will take the form of
     *
     * {
     *   ">": 5,
     *   "<>": 10,
     *   etc...
     * }
     *
     * Each operator in an operatorsDefinition is implicitly ANDed
     *
     * @param conditionKey
     * @param operatorsDefinition
     */
    var mapOperatorsObjectToConditionExpression = function( conditionKey, operatorsDefinition ) {

        var operations = [];

        for ( var currentOperator in operatorsDefinition ) {
            if ( operatorsDefinition.hasOwnProperty( currentOperator ) ) {
                operations.push( writeOperatorExpression( conditionKey, currentOperator, operatorsDefinition[ currentOperator ] ) );
            }
        }

        if ( operations.length === 1 ) {
            return operations[ 0 ];
        }

        return '( ' + operations.join( ' AND ' ) + ' )';

    };

    var mapCompositeExpressionDefinitionToConditionExpression = function( compositionType, composedExpressionDefinitions ) {

        var expressions = [];

        composedExpressionDefinitions.forEach( function( currentComposedExpressionDefinition ) {
            var currentExpressions = [];

            for ( var conditionKey in currentComposedExpressionDefinition ) {
                if ( currentComposedExpressionDefinition.hasOwnProperty( conditionKey ) ) {
                    currentExpressions.push( mapExpressionDefinitionToConditionExpression( conditionKey, currentComposedExpressionDefinition[ conditionKey ] ) );
                }
            }

        } );

        return '( ' + expressions.join( ' ' + compositionType + ' ' ) + ' )';

    };

    var mapNotExpressionDefinitionToConditionExpression = function( expressionDefinition ) {

        var expressions = [];

        for ( var conditionKey in expressionDefinition ) {
            if ( expressionDefinition.hasOwnProperty( conditionKey ) ) {
                expressions.push( mapExpressionDefinitionToConditionExpression( conditionKey, expressionDefinition[ conditionKey ] ) );
            }
        }

        if ( expressions.length === 1 ) {
            return 'NOT ' + expressions[ 0 ];
        }

        return 'NOT ( ' + expressions.join( ' AND ' ) + ' )';

    };

    var mapExpressionDefinitionToConditionExpression = function( conditionKey, expressionDefinition ) {

        //Check if the key is a special key
        if ( conditionKey == 'AND' || conditionKey == 'OR' ) {
            return mapCompositeExpressionDefinitionToConditionExpression( conditionKey, expressionDefinition );
        }
        if ( conditionKey == 'NOT' ) {
            return mapNotExpressionDefinitionToConditionExpression( expressionDefinition );
        }

        if ( !namesForExpressionAttributes[ conditionKey ] ) {
            namesForExpressionAttributes[ conditionKey ] = '#' + expressionAttributeNamesCount;
            expressionAttributeNames[ '#' + expressionAttributeNamesCount ] = conditionKey;
            expressionAttributeNamesCount += 1;
        }

        if ( typeof expressionDefinition === 'object' ) {
            return mapOperatorsObjectToConditionExpression( conditionKey, expressionDefinition );
        }

        return writeOperatorExpression( conditionKey, '=', expressionDefinition );

    };

    var expressions = [];
    for ( var conditionKey in conditionDefinition ) {
        if ( conditionDefinition.hasOwnProperty( conditionKey ) ) {
            expressions.push( mapExpressionDefinitionToConditionExpression( conditionKey, conditionDefinition[ conditionKey ] ) );
        }
    }

    return {
        conditionExpression: expressions.join( ' AND ' ),
        expressionAttributeNames: expressionAttributeNames,
        expressionAttributeValues: mapJavascriptObjectToDynamoObject( expressionAttributeValues )
    };

};

var mapUpdatesToUpdateExpression = function( updates ) {

    //TODO: Handle operations other than SET in some way
    var updateExpressions = [];
    var expressionAttributeValues = {};

    var i = 1;
    for ( var key in updates ) {
        if ( updates.hasOwnProperty( key ) ) {
            expressionAttributeValues[ ':' + i ] = updates[ key ];
            updateExpressions.push( key + ' = :' + i );

            i++;
        }
    }

    return {
        updateExpression: 'SET ' + updateExpressions.join( ', ' ),
        expressionAttributeValues: mapJavascriptObjectToDynamoObject( expressionAttributeValues )
    };

};

var keyConditionForKeyConditionString = function( condition, keyType ) {

    var conditionParts = condition.split( ' ' );
    var conditionValues = conditionParts.length > 1 ? conditionParts.slice( 1 ) : conditionParts;
    var conditionOperator = conditionParts.length > 1 ? conditionParts[ 0 ] : 'EQ';

    var keyCondition = { AttributeValueList: [] };
    keyCondition.ComparisonOperator = conditionOperator;
    conditionValues.forEach( function( currentConditionValue ) {
        var newKeyCondition = {};
        newKeyCondition[ keyType ] = currentConditionValue;
        keyCondition.AttributeValueList.push( newKeyCondition );

        //TODO: this works for simple types like S, N, and BOOL but will not work for more complex types
    } );

    return keyCondition;

};

var mapKeySchemaToIndexDefinition = function( keySchema, attributeDefinitions ) {

    var newIndex = {};

    keySchema.forEach( function( currentKeySchema ) {
        if ( currentKeySchema.KeyType === 'HASH' ) {
            newIndex.key = currentKeySchema.AttributeName;
            newIndex.keyType = attributeDefinitions[ currentKeySchema.AttributeName ];
        } else if ( currentKeySchema.KeyType === 'RANGE' ) {
            newIndex.range = currentKeySchema.AttributeName;
            newIndex.rangeType = attributeDefinitions[ currentKeySchema.AttributeName ];
        }
    } );

    return newIndex;

};

/**
 *
 * Usage: var DB = require( 'dynamodb' );
 *        var db = new DB( { accessKeyId: "199238", secretAccessKey: "20390293", region: "east" }, [ { name: "mytable", key: "id", keyType: "S" } ] )
 *
 * Construction will produce a new object containing properties for each table specified.  For instance, after making
 * the above call, you can run get item via the command db.mytable.getItem( '123' ).then( function( item ) { ... } );
 *
 * Get operations map the Dynamo DB item structures to plain JavaScript objects
 * Conversely, put and update operations take plain JavaScript objects and map them to Dynamo DB item structures so you
 * don't need to deal with the matter in your code.
 *
 * @param o
 * @param tables List of table definitions.  Table definitions take the following structure
 *   {
 *     name: "table-name",
 *     key: "primary-key-name",
 *     keyType: One of the Dynamo data type indicators
 *   }
 *   //TODO: Deal with tables with multiple indices
 * @constructor
 */
var DynamoDb = function( o, tables ) {
    var options = o || {};
    var self = this;

    if ( !o.accessKeyId || !o.secretAccessKey || !o.region ) {
        throw new Error( 'AWS Access Key ID, Secret Access Key, and Region must all be provided as database connection options' );
    }

    AWS.config.update( {
        accessKeyId: options.accessKeyId,
        secretAccessKey: options.secretAccessKey,
        region: options.region
    } );

    var dynamodb = new AWS.DynamoDB();

    tables.forEach( function( currentTable ) {

        var tableDefinitionDeferred = Q.defer();
        var tableDefinitionPromise = tableDefinitionDeferred.promise;

        dynamodb.describeTable( {
            TableName: currentTable
        }, function( err, data ) {
            if ( err ) {
                tableDefinitionDeferred.reject( err );
            }
            else {
                var attributeDefinitions = {};
                var secondaryIndices = {};
                var primaryIndex = {};

                data.Table.AttributeDefinitions.forEach( function( currentAttributeDefinition ) {
                    attributeDefinitions[ currentAttributeDefinition.AttributeName ] = currentAttributeDefinition.AttributeType;
                } );

                primaryIndex = mapKeySchemaToIndexDefinition( data.Table.KeySchema, attributeDefinitions );

                if ( data.Table.GlobalSecondaryIndexes ) {
                    data.Table.GlobalSecondaryIndexes.forEach(function (currentGlobalIndex) {
                        secondaryIndices[currentGlobalIndex.IndexName] = mapKeySchemaToIndexDefinition(currentGlobalIndex.KeySchema, attributeDefinitions);
                    });
                }

                if ( data.Table.LocalSecondaryIndexes ) {
                    data.Table.LocalSecondaryIndexes.forEach(function (currentLocalIndex) {
                        secondaryIndices[currentLocalIndex.IndexName] = mapKeySchemaToIndexDefinition(currentLocalIndex.KeySchema, attributeDefinitions);
                    });
                }

                tableDefinitionDeferred.resolve( {
                    name: currentTable,
                    primaryIndex: primaryIndex,
                    secondaryIndices: secondaryIndices
                } );
            }
        } );

        self[ currentTable ] = {
            getItem: function( hash, range ) {

                return tableDefinitionPromise.then( function( tableDefinition ) {

                    var deferred = Q.defer();

                    queryOptions = { Key: {} };
                    queryOptions.Key[ tableDefinition.primaryIndex.key ] = {};
                    queryOptions.Key[ tableDefinition.primaryIndex.key ][ tableDefinition.primaryIndex.keyType ] = hash;

                    if ( tableDefinition.primaryIndex.range ) {
                        if ( !range ) {
                            throw new Error( tableDefinition.name + " requires both a hash and range key but only a hash was provided" );
                        }

                        queryOptions.Key[ tableDefinition.primaryIndex.range ] = {};
                        queryOptions.Key[ tableDefinition.primaryIndex.range ][ tableDefinition.primaryIndex.rangeType ] = range;
                    }

                    queryOptions.TableName = tableDefinition.name;

                    dynamodb.getItem( queryOptions, function( err, data ) {

                        if ( err ) {
                            deferred.reject( err );
                            return;
                        }

                        if ( options.mapResults !== false ) {
                            deferred.resolve( mapDynamoObjectToJavascriptObject( data.Item ) );
                        } else {
                            deferred.resolve( data.Item );
                        }

                    } );

                    return deferred.promise;

                } );

            },

            query: function( hash, range, index ) {

                var executed = false;

                var deferred = Q.defer();

                var queryOptions = {
                    TableName: currentTable,
                    KeyConditions: {}
                };

                var queryable = {
                    limit: function( limit ) {
                        if ( executed ) {
                            throw new Error( "Query may not be modified after execution" );
                        }
                        queryOptions.Limit = limit;
                        return queryable;
                    },
                    filter: function( conditionDefinition ) {
                        if ( executed ) {
                            throw new Error( "Query may not be modified after execution" );
                        }

                        var conditionExpression = mapConditionDefinitionToConditionExpression( conditionDefinition );

                        queryOptions.FilterExpression = conditionExpression.conditionExpression;
                        queryOptions.ExpressionAttributeNames = conditionExpression.expressionAttributeNames;
                        queryOptions.ExpressionAttributeValues = conditionExpression.expressionAttributeValues;

                        return queryable;
                    },
                    then: function( f ) {
                        if ( !executed ) {

                            executed = true;

                            tableDefinitionPromise.then( function( tableDefinition ) {

                                var queryIndex = tableDefinition.primaryIndex;

                                if ( index ) {
                                    queryIndex = tableDefinition.secondaryIndices[ index ];

                                    queryOptions.IndexName = index;
                                }

                                queryOptions.KeyConditions[ queryIndex.key ] = keyConditionForKeyConditionString( hash, queryIndex.keyType );

                                if ( range && queryIndex.range ) {
                                    queryOptions.KeyConditions[ queryIndex.range ] = keyConditionForKeyConditionString( range, queryIndex.rangeType );
                                }

                                dynamodb.query( queryOptions, function( err, data ) {

                                    if ( err ) {
                                        deferred.reject( err );
                                        return;
                                    }

                                    deferred.resolve( mapDynamoObjectsToJavascriptObjects( data.Items ) );

                                } );

                            } );

                        }

                        return deferred.promise.then( f );
                    }
                };

                return queryable;

            },

            scan: function( conditionDefinition ) {

                var executed = false;

                var deferred = Q.defer();

                var queryOptions = {
                    TableName: currentTable
                };

                var conditionExpression = mapConditionDefinitionToConditionExpression( conditionDefinition );

                if (conditionExpression.conditionExpression) { queryOptions.FilterExpression = conditionExpression.conditionExpression; }
                if (Object.keys(conditionExpression.expressionAttributeNames).length > 0) { queryOptions.ExpressionAttributeNames = conditionExpression.expressionAttributeNames; }
                if (Object.keys(conditionExpression.expressionAttributeValues).length > 0) { queryOptions.ExpressionAttributeValues = conditionExpression.expressionAttributeValues; }

                var scannable = {
                    limit: function( limit ) {
                        if ( executed ) {
                            throw new Error( "Query may not be modified after execution" );
                        }
                        queryOptions.Limit = limit;
                        return scannable;
                    },
                    then: function( f ) {
                        if ( !executed ) {

                            executed = true;

                            tableDefinitionPromise.then( function( tableDefinition ) {

                                dynamodb.scan( queryOptions, function( err, data ) {

                                    if ( err ) {
                                        deferred.reject( err );
                                        return;
                                    }

                                    deferred.resolve( mapDynamoObjectsToJavascriptObjects( data.Items ) );

                                } );

                            } );

                        }

                        return deferred.promise.then( f );
                    }
                };

                return scannable;

            },

            /**
             *
             * Valid Options
             *
             * <ul>
             *     <li>conditionExpression - a Condition Expression Definition which must resolve to true for the Put to be applied</li>
             *     <li>returnConsumedCapacity - one of INDEXES, TOTAL, or NONE.  Defaults to NONE</li>
             *     <li>returnItemCollectionMetrics - one of SIZE or NONE.  Defaults to NONE</li>
             *     <li>returnValues - one of NONE, ALL_OLD, UPDATED_OLD, ALL_NEW, UPDATED_NEW</li>
             * </ul>
             *
             * @param item Object representing the item to Put.  Required fields follow the attribute requirements of the SDK putItem call
             * @param o Options object - see Valid Options in the description
             * @returns {*}
             */
            putItem: function( item, o ) {

                var options = o || {};

                return tableDefinitionPromise.then( function( tableDefinition ) {
                    var deferred = Q.defer();

                    var queryOptions = {
                        Item: mapJavascriptObjectToDynamoObject( item ),
                        TableName: tableDefinition.name
                    };

                    if ( options.conditionExpression ) {
                        var conditionExpression = mapConditionDefinitionToConditionExpression( options.conditionExpression );

                        queryOptions.ConditionExpression = conditionExpression.conditionExpression;
                        queryOptions.ExpressionAttributeNames = conditionExpression.expressionAttributeNames;
                        queryOptions.ExpressionAttributeValues = conditionExpression.expressionAttributeValues;
                    }

                    if ( options.returnConsumedCapacity ) {
                        queryOptions.ReturnConsumedCapacity = options.returnConsumedCapacity;
                    }

                    if ( options.returnItemCollectionMetrics ) {
                        queryOptions.ReturnItemCollectionMetrics = options.returnItemCollectionMetrics;
                    }

                    if ( options.returnValues ) {
                        queryOptions.ReturnValues = options.returnValues;
                    }

                    dynamodb.putItem( queryOptions, function( err, data ) {
                        if ( err ) {
                            deferred.reject( err );
                            return;
                        }

                        deferred.resolve( item );
                    } );

                    return deferred.promise;
                } );

            },

            deleteItem: function( hash, itemRange ) {

                return tableDefinitionPromise.then( function( tableDefinition ) {

                    var deferred = Q.defer();

                    queryOptions = { Key: {} };
                    queryOptions.Key[ tableDefinition.primaryIndex.key ] = {};
                    queryOptions.Key[ tableDefinition.primaryIndex.key ][ tableDefinition.primaryIndex.keyType ] = hash;

                    if ( tableDefinition.primaryIndex.range ) {
                        if ( !itemRange ) {
                            throw new Error( tableDefinition.name + " requires both a hash and range key but only a hash was provided" );
                        }

                        queryOptions.Key[ tableDefinition.primaryIndex.range ] = {};
                        queryOptions.Key[ tableDefinition.primaryIndex.range ][ tableDefinition.primaryIndex.rangeType ] = itemRange;
                    }

                    queryOptions.TableName = tableDefinition.name;

                    dynamodb.deleteItem( queryOptions, function( err, data ) {
                        if ( err ) {
                            deferred.reject( err );
                            return;
                        }

                        deferred.resolve();
                    } );

                    return deferred.promise;

                } );
            },

            updateItem: function( hash, itemRange, itemUpdates ) {

                var updates = typeof itemRange === 'object' ? itemRange : itemUpdates;
                var range = typeof itemRange === 'string' ? itemRange : null;

                return tableDefinitionPromise.then( function( tableDefinition ) {

                    var deferred = Q.defer();

                    queryOptions = { Key: {} };
                    queryOptions.Key[ tableDefinition.primaryIndex.key ] = {};
                    queryOptions.Key[ tableDefinition.primaryIndex.key ][ tableDefinition.primaryIndex.keyType ] = hash;

                    if ( tableDefinition.primaryIndex.range ) {
                        if ( !range ) {
                            throw new Error( tableDefinition.name + " requires both a hash and range key but only a hash was provided" );
                        }

                        queryOptions.Key[ tableDefinition.primaryIndex.range ] = {};
                        queryOptions.Key[ tableDefinition.primaryIndex.range ][ tableDefinition.primaryIndex.rangeType ] = range;
                    }

                    queryOptions.TableName = tableDefinition.name;

                    var updateExpression = mapUpdatesToUpdateExpression( updates );

                    queryOptions.UpdateExpression = updateExpression.updateExpression;
                    queryOptions.ExpressionAttributeValues = updateExpression.expressionAttributeValues;

                    dynamodb.updateItem( queryOptions, function( err, data ) {
                        if ( err ) {
                            deferred.reject( err );
                            return;
                        }

                        //TODO: Resolve to updated item
                        deferred.resolve();
                    } );

                    return deferred.promise;

                } );
            }
        }
    } );

};


DynamoDb.consumedCapacityOptions = {
    "INEXES": "INDEXES",
    "TOTAL": "TOTAL",
    "NONE": "NONE"
};

DynamoDb.itemCollectionMetricsOptions = {
    "SIZE": "SIZE",
    "NONE": "NONE"
};

DynamoDb.valuesOptions = {
    "NONE": "NONE",
    "ALLOLD": "ALL_OLD",
    "UPDATEDOLD": "UPDATED_OLD",
    "ALLNEW": "ALL_NEW",
    "UPDATEDNEW": "UPDATED_NEW"
};

module.exports = function( o, tables ) {
    return new DynamoDb( o, tables );
};