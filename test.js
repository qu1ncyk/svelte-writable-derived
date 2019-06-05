var loadEsm = require("esm")(module);
var writableDerived = loadEsm("./index.mjs").default;
var { writable, readable, get } = loadEsm("svelte/store");
var assert = require('assert').strict;

describe("origins parameter", function() {
	specify("get subscribed to only when the derived store is subscribed to", function() {
		var subscriptionAllowed = false, passing = false;
		var origin = writable(0, () => {
			assert.ok(subscriptionAllowed);
			passing = true;
		});
		var testing = writableDerived(origin, () => 1, () => 1);
		subscriptionAllowed = true;
		testing.subscribe(() => {});
		assert.ok(passing);
	});
	specify("get unsubscribed from when the derived store has no more subscriptions", function() {
		var unsubscriptionAllowed = false, passing = false;
		var origin = writable(0, () => {
			return () => {
				assert.ok(unsubscriptionAllowed);
				passing = true;
			};
		});
		var testing = writableDerived(origin, () => 1, () => 1);
		var unsubscribe1 = testing.subscribe(() => {});
		var unsubscribe2 = testing.subscribe(() => {});
		unsubscribe1();
		unsubscriptionAllowed = true;
		unsubscribe2();
		assert.ok(passing);
	});
});
describe("derive parameter", function() {
	function deriveSetTests(makeSetter) {
		specify("set the derived store's value", function() {
			var expected = 1, actual;
			var {derive, whenDone} = makeSetter(1);
			var testing = writableDerived(writable(0), derive, () => {});
			testing.subscribe( (value) => { actual = value; } );
			return whenDone( () => {
				assert.equal(get(testing), expected);
			} );
		});
		specify("does not call reflect", function() {
			var {derive, whenDone} = makeSetter(1);
			var testing = writableDerived(writable(0), derive, () => {
				assert.fail();
			});
			testing.subscribe( () => {} );
			return whenDone( () => {} );
		});
	}
	describe("synchronous form", function() {
		deriveSetTests(function makeSetter(setValue) {
			return {
				derive: () => setValue,
				whenDone: (fn) => { fn(); },
			}
		});
	});
	describe("asynchronous form", function() {
		deriveSetTests(function makeSetter(setValue) {
			var setIsDone;
			var whenSetDone = new Promise( (resolve) => { setIsDone = resolve; } );
			return {
				derive(value, set) {
					Promise.resolve().then( () => {
						set(setValue);
						setIsDone();
					} );
				},
				whenDone(fn) { return whenSetDone.then(fn); },
			};
		});
		specify("can set synchronously", function() {
			var expected = 1;
			var testing = writableDerived(writable(0), (value, set) => {
				set(expected);
			}, () => {}, 2)
			assert.equal(get(testing), expected);
		});
		specify("does not set with the return value", function() {
			var unexpected = () => {};
			var testing = writableDerived(writable(0), (value, set) => {
				return unexpected;
			}, () => {}, 2);
			assert.notEqual(get(testing), unexpected);
		});
		specify("return value called as a cleanup function", function() {
			var origin = writable(0);
			var noOfCalls = 0;
			var testing = writableDerived(origin, (value, set) => {
				return () => { ++noOfCalls; };
			}, () => {});
			var unsubscribe = testing.subscribe(() => {});
			origin.set(1);
			unsubscribe();
			assert.equal(noOfCalls, 2);
		});
		specify("first subscription does not update derived store until set", function() {
			var expected = 2;
			var setter;
			var testing = writableDerived(writable(0), (value, set) => {
				setter = set;
			}, ({set}) => {});
			var unsubscribe = testing.subscribe(() => {});
			setter(1);
			unsubscribe();
			testing.set(expected);
			testing.subscribe(() => {});
			assert.equal(get(testing), expected);
		});
		specify("derived has initial value until first set", function () {
			var expected = 1;
			var testing = writableDerived(writable(0), (value, set) => {}, () => {}, expected);
			testing.subscribe(() => {});
			assert.equal(get(testing), expected);
		});
	});
});
describe("reflect parameter", function() {
	specify("called upon set and receives new value", function() {
		var passed;
		var testing = writableDerived(writable(), () => 1, ({reflecting}) => {
			passed = reflecting == 2;
		});
		testing.set(2);
		assert.ok(passed);
	});
	specify("called upon update and receives new value", function() {
		var passed;
		var testing = writableDerived(writable(), () => 1, ({reflecting}) => {
			passed = reflecting == 2;
		});
		testing.update(() => 2);
		assert.ok(passed);
	});
	specify("not called when new and old values are equal primitives", function() {
		var testing = writableDerived(writable(), () => 1, () => {
			assert.fail();
		});
		testing.subscribe( () => {} );
		testing.set(1);
	});
	specify("called before subscriptions", function() {
		var actual = [], collectSubscriptionCalls = false;
		var testing = writableDerived(writable(), () => 1, ({set}) => {
			actual.push("reflect");
		});
		testing.subscribe( () => {
			if (collectSubscriptionCalls) {
				actual.push("subscription");
			}
		} );
		collectSubscriptionCalls = true;
		testing.set(2);
		assert.deepStrictEqual(actual, ["reflect", "subscription"]);
	});
	describe("old origin values", function() {
		var datasets = [
			{
				name: "single origin",
				getOrigins: () => writable(1),
				expected: 1,
			},
			{
				name: "multiple origins (incl. non-writables)",
				getOrigins: () => [writable(1), readable(2, () => {})],
				expected: [1, 2],
			},
		];
		for (let {name, getOrigins, expected} of datasets) {
			specify(`${name}, active subscription`, function() {
				var testing = writableDerived(getOrigins(), () => 3, ({old, set}) => {
					assert.deepStrictEqual(old, expected);
				});
				testing.subscribe( () => {} );
				testing.set(4);
			});
			specify(`${name}, no subscription`, function() {
				var testing = writableDerived(getOrigins(), () => 3, ({old, set}) => {
					assert.deepStrictEqual(old, expected);
				});
				testing.set(4);
			});
		}
	});
	
	function originSetTests(makeSetter) {
		specify("sets single origin", function() {
			var origin = writable(0);
			var expected = 3;
			var {reflect, whenDone} = makeSetter(expected);
			var testing = writableDerived(origin, () => 1, reflect);
			testing.set(2);
			return whenDone( () => {
				assert.equal(get(origin), expected);
			} );
		});
		specify("sets multiple origins", function() {
			var origins = [writable(1), writable(2)];
			var expected = [3, 4];
			var {reflect, whenDone} = makeSetter(expected);
			var testing = writableDerived(origins, () => 0, reflect);
			testing.set(-1);
			return whenDone( () => {
				assert.deepStrictEqual(expected, origins.map(get));
			} );
		});
		specify("sets subset of multiple origins", function() {
			var origins = [writable(1), writable(2), writable(3), writable(4)];
			var expected = [5, 2, 6, 4];
			var {reflect, whenDone} = makeSetter([expected[0], , expected[2]]);
			var testing = writableDerived(origins, () => 0, reflect);
			testing.set(-1);
			return whenDone( () => {
				assert.deepStrictEqual(expected, origins.map(get));
			} );
		});
		specify("does not call derived", function() {
			var deriveAllowed = true;
			var {reflect, whenDone} = makeSetter(1);
			var testing = writableDerived(writable(0), () => {
				assert.ok(deriveAllowed);
				return 0;
			}, reflect);
			deriveAllowed = false;
			testing.set(1);
			return whenDone( () => {} );
		});
	}
	describe("synchronous form", function() {
		originSetTests(function makeSetter(setValue) {
			return {
				reflect: () => setValue,
				whenDone: (fn) => { fn(); },
			}
		});
	});
	describe("asynchronous form", function() {
		originSetTests(function makeSetter(setValue) {
			var setIsDone;
			var whenSetDone = new Promise( (resolve) => { setIsDone = resolve; } );
			return {
				reflect({set}) {
					Promise.resolve().then( () => {
						set(setValue);
						setIsDone();
					} );
				},
				whenDone(fn) { return whenSetDone.then(fn); },
			};
		});
		specify("does not set with the return value", function() {
			var expected = 0;
			var origin = writable(expected);
			var testing = writableDerived(origin, () => {}, ({set}) => {
				return () => {};
			});
			testing.set(1);
			assert.equal(get(origin), 0);
		});
		specify("return value called as a cleanup function", function() {
			var noOfCalls = 0;
			var testing = writableDerived(writable(0), () => {}, ({set}) => {
				return () => { ++noOfCalls; };
			});
			testing.set(1);
			testing.set(2);
			assert.equal(noOfCalls, 1);
		});
	});
});
describe("update method", function() {
	specify("calls derive if there are no subscribers", function() {
		var passing = false;
		var testing = writableDerived(writable(), () => {
			passing = true;
		}, () => {});
		testing.update( () => {} );
		assert.ok(passing);
	});
});