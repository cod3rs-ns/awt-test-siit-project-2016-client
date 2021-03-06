(function() {
    'use strict';

    angular
        .module('awt-cts-client')
        .controller('AnnouncementFormController', AnnouncementFormController);

    AnnouncementFormController.$inject = ['$state', '$stateParams', '$localStorage', '$location', '$log', '_', 'FileUploader', 'Notification', 'announcementService', 'reportingService', 'WizardHandler', 'DatePickerService', 'CONFIG'];

    function AnnouncementFormController($state, $stateParams, $localStorage, $location, $log, _, FileUploader, Notification,  announcementService, reportingService, WizardHandler, DatePickerService, CONFIG) {

        var announcementFormVm = this;

        announcementFormVm.chosenSimilarRealEstateId = -1;
        announcementFormVm.similars = [];
        announcementFormVm.similarsDisabled = true;

        // Datepicker configuration
        announcementFormVm.datePickerConfig = datePickerConfig;

        announcementFormVm.submitAnnouncement = submitAnnouncement;
        announcementFormVm.chooseSimilarRealEstate = chooseSimilarRealEstate;
        announcementFormVm.getSimilarRealEstates = getSimilarRealEstates;
        announcementFormVm.deleteItemFromQueue = deleteItemFromQueue;
        announcementFormVm.canExitFirtsStep = canExitFirtsStep;
        announcementFormVm.setRealEstateForm = setRealEstateForm;
        announcementFormVm.setAnnouncementForm = setAnnouncementForm;

        activate();

        function activate() {
            if ($localStorage.role !== 'advertiser') {
                $location.path('/unauthorized');
            }

            announcementFormVm.state = $state.current.name;

            announcementFormVm.uploader = new FileUploader({
                url: CONFIG.SERVICE_URL + '/images/announcements/',
                headers: {
                    "X-Auth-Token": $localStorage.token
                }
            });

            setUploaderFilters();
            createUploaderCallbacks();

            if (announcementFormVm.state === 'addAnnouncement') {
                announcementFormVm.announcement = createInitialAnnouncement();
                announcementFormVm.datePickerConfig();
                announcementFormVm.uploaded = false;
            }
            else {
                announcementFormVm.datePickerConfig();
                announcementService.getAnnouncementById($stateParams.announcementId)
                    .then(function(response) {
                        announcementFormVm.announcement = response.data;
                        _.forEach(response.data.images, function(image, index) {
                            announcementService.dummyImageUpload(image, index, announcementFormVm.uploader)
                              .then(function(response) {
                                  $log.info('Dummy upload completed...');
                              })
                              .catch(function(error) {
                                  $log.error(error);
                              });
                        });
                        announcementFormVm.uploader.progress = 100;
                    })
                    .catch(function(error) {
                        $log.error(error);
                    });
            }
        }

        function submitAnnouncement() {
            var notUploaded = announcementFormVm.uploader.getNotUploadedItems();

            if (!_.isNull(announcementFormVm.chosenSimilarRealEstateId)) {
                announcementFormVm.announcement.realEstate.id = announcementFormVm.chosenSimilarRealEstateId;
            }

            if (announcementFormVm.state === "updateAnnouncement" && _.isEmpty(notUploaded)) {
                updateAnnouncement(announcementFormVm.announcement);
            }
            else {
                announcementFormVm.uploader.uploadAll();
            }
        }

        function datePickerConfig() {
            announcementFormVm.datePickerConfig = DatePickerService.getConfiguration();
        }

        function setUploaderFilters() {
            // FILTERS
            announcementFormVm.uploader.filters.push({
                name: 'imageFilter',
                fn: function(item /*{File|FileLikeObject}*/, options) {
                    var type = '|' + item.type.slice(item.type.lastIndexOf('/') + 1) + '|';
                    return '|jpg|png|jpeg|bmp|gif|'.indexOf(type) !== -1;
                }
            });

            announcementFormVm.uploader.filters.push({
                name: 'enforceMaxFileSize',
                fn: function(item) {
                    var retVal = item.size <= 5242880; // 5 MB
                    if (!retVal) {
                      Notification.error({ message: '<p class="danger" id="wrong-file-size">Veličina fajla mora biti manja od <strong>5MB</strong>.</p>' });
                    }
                    return retVal;
                }
            });

            announcementFormVm.uploader.filters.push({
                name: 'queueLimit',
                fn: function(item) {
                    var retVal = announcementFormVm.uploader.queue.length == 4; // 4 images per announcement
                    if (retVal) {
                        Notification.error({ message: '<p class="danger" id="wrong-number-image">Ne možete postaviti više od <strong>4</strong> slike.</p>' });
                    }
                    return !retVal;
                }
            });
        }

        function deleteItemFromQueue(item) {
            if (announcementFormVm.state == "updateAnnouncement" && !_.isUndefined(item.file.realImg)) {
                _.remove(announcementFormVm.announcement.images, function(image) {
                    return image.id === item.file.realImg.id;
                })
            }

            item.remove();
        }

        function addNewAnnouncement() {
            announcementService.addAnnouncement(announcementFormVm.announcement)
                .then(function(response) {
                    if (!_.isEmpty(announcementFormVm.similars)) {
                        var report = {
                            email: 'system',
                            content: 'Postoje slične nekretnine',
                            type: 'similar-realEstate',
                            status: 'pending',
                            announcement: { id: response.data.id }
                        }
                        // Create new report if announcement is referenced to existed real estate
                        reportingService.createReport(report);
                    }

                    $state.transitionTo("announcement", {
                        announcementId: response.data.id
                    });
                })
                .catch(function(error) {
                    $log.error(error);
                });
        }

        function updateAnnouncement() {
            announcementService.updateAnnouncement(announcementFormVm.announcement)
                .then(function(response) {
                    if (!_.isEmpty(announcementFormVm.similars)) {
                        var report = {
                            email: 'system',
                            content: 'Postoje slične nekretnine',
                            type: 'similar-realEstate',
                            status: 'pending',
                            announcement: { id: response.data.id }
                        }
                        // Create new report if announcement is referenced to existed real estate
                        reportingService.createReport(report);
                    }

                    $state.transitionTo("announcement", {
                        announcementId: response.data.id
                    });
                })
                .catch(function(error) {
                    $log.error(error);
                });
        }

        function createUploaderCallbacks() {
            // Callbacks for one image upload
            announcementFormVm.uploader.onSuccessItem = function(fileItem, response, status, headers) {
                announcementFormVm.announcement.images.push({ id: null, imagePath: response });
            };

            announcementFormVm.uploader.onCompleteAll = function() {
                announcementFormVm.uploaded = true;

                if (announcementFormVm.state === 'addAnnouncement') {
                    addNewAnnouncement();
                }
                else {
                    updateAnnouncement();
                }
            };
        }

        function chooseSimilarRealEstate(id) {
            announcementFormVm.chosenSimilarRealEstateId = id;
        };

        function getSimilarRealEstates() {
            announcementService.getSimilarRealEstates(announcementFormVm.announcement.realEstate)
                .then(function(response) {
                    announcementFormVm.chosenSimilarRealEstateId = null;
                    announcementFormVm.similars = response.data;

                    if (announcementFormVm.state !== 'addAnnouncement') {
                        _.remove(announcementFormVm.similars, function(realEstate) {
                            return realEstate.id == announcementFormVm.announcement.realEstate.id;
                        });
                    }

                    if (!_.isEmpty(announcementFormVm.similars)) {
                        announcementFormVm.similarsDisabled = false;
                        WizardHandler.wizard().goTo("Slične nekretnine");
                    }
                    else {
                        announcementFormVm.similarsDisabled = true;
                        WizardHandler.wizard().goTo("Slike");
                    }
                })
                .catch(function(error) {
                    $log.error(error);
                });
        };

        function setAnnouncementForm(form) {
            announcementFormVm.announcementForm = form;
        }

        function setRealEstateForm(form) {
            announcementFormVm.realEstateForm = form;
        }

        function canExitFirtsStep() {
            var formValid = !announcementFormVm.announcementForm.$invalid && !announcementFormVm.realEstateForm.$invalid;
            if (!formValid) {
                Notification.error({ message: '<p class="danger" id="required-fields">Morate popuniti sva polja ispravno da biste prešli na sljedeći korak.</p>' });
                return false;
            } else {
                var address = announcementFormVm.announcement.realEstate.location.city + ' ' + announcementFormVm.announcement.realEstate.location.street + ' ' +
                    announcementFormVm.announcement.realEstate.location.country;

                return findLocation(address)
                    .then(function(response) {
                        return response;
                    }, function(response) {
                        Notification.error({ message: '<p class="danger" id="wrong-address">Adresa koju ste unijeli je nevalidna.</p>' });
                        return response;
                    });
            }
        }

        function createInitialAnnouncement() {
            return {
                dateAnnounced: _.now(),
                expirationDate: _.now(),
                verified: false,
                images: [],
                description: '',
                type: 'buy',
                realEstate: {
                    deleted: false,
                    type: 'other',
                    heatingType: 'central',
                    location: {},
                    announcements: []
                }
            };
        }

        function findLocation(location) {
            var deferred = $.Deferred();
            var geocoder = new google.maps.Geocoder();

            geocoder.geocode({ 'address': location }, function(results, status) {
                if (status === google.maps.GeocoderStatus.OK) {
                    announcementFormVm.announcement.realEstate.location.latitude = results[0].geometry.location.lat();
                    announcementFormVm.announcement.realEstate.location.longitude = results[0].geometry.location.lng();
                    deferred.resolve(true);
                } else {
                    deferred.reject(false);
                }
            });

            return deferred.promise();
        }
    }
})();