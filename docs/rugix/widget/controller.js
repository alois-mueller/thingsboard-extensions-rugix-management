self.onInit = function() {
};

self.onDataUpdated = function() {
    if (self.ctx.$scope.rugixAgentsComponent) {
        self.ctx.$scope.rugixAgentsComponent.onDataUpdated();
    }
};

self.typeParameters = function() {
    return {
        hasDataPageLink: false,
        dataKeysOptional: true
    };
};

self.onDestroy = function() {
};
