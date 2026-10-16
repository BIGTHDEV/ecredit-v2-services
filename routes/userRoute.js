const express = require('express');
const authenticationMiddleware = require('../middlewares/authentication');
const userController = require('../controllers/userController');

const router = express.Router();
router.get('/', authenticationMiddleware, userController.listUsers);
router.get('/employee-options', authenticationMiddleware, userController.listEmployeeOptions);
router.get('/roles', authenticationMiddleware, userController.listRoleOptions);
router.get('/permission-options', authenticationMiddleware, userController.listPermissionOptions);
router.post('/', authenticationMiddleware, userController.createUser);
router.get('/:code', authenticationMiddleware, userController.getUserDetail);
router.get('/:code/permissions', authenticationMiddleware, userController.getUserPermissions);
router.put('/:code/permissions', authenticationMiddleware, userController.updateUserPermissions);
router.put('/:code/access', authenticationMiddleware, userController.updateUserAccess);
router.patch('/:code/system-active', authenticationMiddleware, userController.updateSystemActive);
router.put('/:code/view-as', authenticationMiddleware, userController.setViewAs);
router.delete('/view-as', authenticationMiddleware, userController.clearViewAs);
module.exports = router;
