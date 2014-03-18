Notebook.create_controller = function(model)
{
    var current_gist_,
        dirty_ = false,
        save_button_ = null,
        save_timer_ = null,
        save_timeout_ = 30000, // 30s
        show_source_checkbox_ = null;

    var default_callback_ = editor.load_callback(null, true, true);

    function append_cell_helper(content, type, id) {
        var cell_model = Notebook.Cell.create_model(content, type);
        var cell_controller = Notebook.Cell.create_controller(cell_model);
        cell_model.controller = cell_controller;
        return {controller: cell_controller, changes: model.append_cell(cell_model, id)};
    }

    function append_asset_helper(content, filename) {
        var asset_model = Notebook.Asset.create_model(content, filename);
        var asset_controller = Notebook.Asset.create_controller(asset_model);
        asset_model.controller = asset_controller;
        return {controller: asset_controller,
                changes: model.append_asset(asset_model, filename)};
    }

    function insert_cell_helper(content, type, id) {
        var cell_model = Notebook.Cell.create_model(content, type);
        var cell_controller = Notebook.Cell.create_controller(cell_model);
        cell_model.controller = cell_controller;
        return {controller: cell_controller, changes: model.insert_cell(cell_model, id)};
    }

    function on_load(version, notebook) {
        if (!_.isUndefined(notebook.files)) {
            var i;
            this.clear();
            var cells = {}; // could rely on alphabetic input instead of gathering
            var assets = {};
            _.each(notebook.files, function (file, k) {
                // ugh, we really need to have a better javascript mapping of R objects..
                if (k === "r_attributes" || k === "r_type")
                    return;
                var filename = file.filename;
                if(/^part/.test(filename)) {
                    // cells
                    var number = parseInt(filename.slice(4).split('.')[0]);
                    if(!isNaN(number))
                        cells[number] = [file.content, file.language, number];
                } else {
                    // assets
                    assets[filename] = [file.content, file.filename];
                }
            });
            // we intentionally drop change objects on the floor, here and only here.
            // that way the cells/assets are checkpointed where they were loaded
            var asset_controller;
            for(i in cells)
                append_cell_helper(cells[i][0], cells[i][1], cells[i][2]);
            for(i in assets) {
                var result = append_asset_helper(assets[i][0], assets[i][1]).controller;
                asset_controller = asset_controller || result;
            }
            model.user(notebook.user.login);
            model.read_only(version != null || notebook.user.login != rcloud.username());
            current_gist_ = notebook;
            asset_controller.select();
        }
        return notebook;
    }

    // calculate the changes needed to get back from the newest version in notebook
    // back to what we are presently displaying (current_gist_)
    function find_changes_from(notebook) {
        function change_object(obj) {
            obj.name = function(n) { return n; };
            return obj;
        }
        var changes = [];

        // notebook files, current files
        var nf = notebook.files,
            cf = _.extend({}, current_gist_.files); // dupe to keep track of changes

        // find files which must be changed or removed to get from nf to cf
        for(var f in nf) {
            if(f==='r_type' || f==='r_attributes')
                continue; // R metadata
            if(f in cf) {
                if(cf[f].language != nf[f].language || cf[f].content != nf[f].content) {
                    changes.push(change_object({filename: f,
                                                language: cf[f].language,
                                                content: cf[f].content}));
                }
                delete cf[f];
            }
            else changes.push(change_object({filename: f, erase: true, language: nf[f].language}));
        }

        // find files which must be added to get from nf to cf
        for(f in cf) {
            if(f==='r_type' || f==='r_attributes')
                continue; // artifact of rserve.js
            changes.push(change_object({filename: f,
                                        language: cf[f].language,
                                        content: cf[f].content}));
        }
        return changes;
    }

    function update_notebook(changes, gistname) {
        // remove any "empty" changes.  we can keep empty cells on the
        // screen but github will refuse them.  if the user doesn't enter
        // stuff in them before saving, they will disappear on next session
        changes = changes.filter(function(change) {
            return change.content || change.erase || change.rename;
        });
        if (!changes.length)
            return Promise.cast(current_gist_);
        if (model.read_only())
            return Promise.reject("attempted to update read-only notebook");
        gistname = gistname || shell.gistname();
        function changes_to_gist(changes) {
            var files = {};
            // play the changes in order - they must be sequenced so this makes sense
            _.each(changes, function(change) {
                if(change.erase || change.rename) {
                    files[change.filename] = null;
                    if(change.rename)
                        files[change.rename] = {content: change.content};
                }
                else files[change.filename] = {content: change.content};
            });
            return {files: files};
        }

        return rcloud.update_notebook(gistname, changes_to_gist(changes))
            .then(function(notebook) {
                if('error' in notebook)
                    throw notebook;
                current_gist_ = notebook;
                return notebook;
            });
    }
    function refresh_cells() {
        return model.reread_cells();
    }

    function on_dirty() {
        if(!dirty_) {
            if(save_button_)
                ui_utils.enable_bs_button(save_button_);
            dirty_ = true;
        }
        if(save_timer_)
            window.clearTimeout(save_timer_);
        save_timer_ = window.setTimeout(function() {
            result.save();
            save_timer_ = null;
        }, save_timeout_);
    }

    function setup_show_source() {
        show_source_checkbox_ = ui_utils.checkbox_menu_item($("#show-source"),
           function() {result.show_r_source();},
           function() {result.hide_r_source();});
        show_source_checkbox_.set_state(true);
    }

    setup_show_source();
    model.dishers.push({on_dirty: on_dirty});

    var result = {
        save_button: function(save_button) {
            if(arguments.length) {
                save_button_ = save_button;
            }
            return save_button_;
        },
        append_asset: function(content, filename) {
            var cch = append_asset_helper(content, filename);
            update_notebook(cch.changes)
                .then(default_callback_);
            return cch.controller;
        },
        append_cell: function(content, type, id) {
            var cch = append_cell_helper(content, type, id);
            update_notebook(cch.changes)
                .then(default_callback_);
            return cch.controller;
        },
        insert_cell: function(content, type, id) {
            var cch = insert_cell_helper(content, type, id);
            update_notebook(cch.changes)
                .then(default_callback_);
            return cch.controller;
        },
        remove_cell: function(cell_model) {
            var changes = model.remove_cell(cell_model);
            RCloud.UI.command_prompt.prompt.widget.focus(); // there must be a better way
            update_notebook(changes)
                .then(default_callback_);
        },
        remove_asset: function(asset_model) {
            var changes = model.remove_asset(asset_model);
            update_notebook(changes)
                .then(default_callback_);
        },
        move_cell: function(cell_model, before) {
            var changes = model.move_cell(cell_model, before ? before.id() : -1);
            update_notebook(changes)
                .then(default_callback_);
        },
        change_cell_language: function(cell_model, language) {
            var changes = model.change_cell_language(cell_model, language);
            update_notebook(changes)
                .then(default_callback_);
        },
        clear: function() {
            model.clear();
            // FIXME when scratchpad becomes a view, clearing the model
            // should make this happen automatically.
            RCloud.UI.scratchpad.clear();
        },
        load_notebook: function(gistname, version) {
            return rcloud.load_notebook(gistname, version || null)
                .then(_.bind(on_load, this, version));
        },
        create_notebook: function(content) {
            var that = this;
            return rcloud.create_notebook(content).then(function(notebook) {
                that.clear();
                model.read_only(notebook.user.login != rcloud.username());
                current_gist_ = notebook;
                return notebook;
            });
        },
        fork_or_revert_notebook: function(is_mine, gistname, version) {
            var that = this;
            // 1. figure out the changes
            var promiseChanges;
            if(is_mine) // revert: get HEAD, calculate changes from there to here, and apply
                promiseChanges = rcloud.load_notebook(gistname, null).then(function(notebook) {
                    return [find_changes_from(notebook), gistname];
                });
            else // fork:
                promiseChanges = rcloud.fork_notebook(gistname).then(function(notebook) {
                    if(version)
                        // fork, then get changes from there to where we are in the past, and apply
                        // git api does not return the files on fork, so load
                        return rcloud.get_notebook(notebook.id, null)
                            .then(function(notebook2) {
                                return [find_changes_from(notebook2), notebook2.id];
                            });
                    else return [[], notebook.id];
                });
            // 2. apply the changes, if any
            return promiseChanges.spread(function(changes, gistname) {
                return changes.length
                    ? update_notebook(changes, gistname)
                    : that.load_notebook(gistname, null); // do a load - we need to refresh
            });
        },
        update_cell: function(cell_model) {
            return update_notebook(model.update_cell(cell_model));
        },
        update_asset: function(asset_model) {
            return update_notebook(model.update_asset(asset_model));
        },
        save: function() {
            if(dirty_) {
                var changes = refresh_cells();
                update_notebook(changes);
                if(save_button_)
                    ui_utils.disable_bs_button(save_button_);
                dirty_ = false;
            }

        },
        run_all: function() {
            this.save();
            _.each(model.cells, function(cell_model) {
                cell_model.controller.set_status_message("Waiting...");
            });

            // will ordering bite us in the leg here?
            var promises = _.map(model.cells, function(cell_model) {
                return Promise.resolve().then(function() {
                    cell_model.controller.set_status_message("Computing...");
                    return cell_model.controller.execute();
                });
            });
            return Promise.all(promises);
        },

        //////////////////////////////////////////////////////////////////////

        is_mine: function() {
            return rcloud.username() === model.user();
        },

        //////////////////////////////////////////////////////////////////////

        _r_source_visible: true,

        hide_r_source: function() {
            this._r_source_visible = false;
            show_source_checkbox_.set_state(this._r_source_visible);
            Notebook.hide_r_source();
        },
        show_r_source: function() {
            this._r_source_visible = true;
            show_source_checkbox_.set_state(this._r_source_visible);
            Notebook.show_r_source();
        }
    };
    model.controller = result;
    return result;
};